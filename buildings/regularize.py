"""Frame Field Regularization for building polygon extraction.

Implements the post-processing pipeline inspired by Girard et al.
"Polygonization by Frame Field Learning" (2021):

1. Derive a frame field from the segmentation mask (or use model output).
2. Extract raw polygons via contour detection.
3. Regularize each polygon so edges snap to the frame-field-aligned
   dominant orientations → squared corners.
"""

import numpy as np
import cv2
from scipy import ndimage
from shapely.geometry import Polygon, MultiPolygon
from shapely.validation import make_valid


# ──────────────────────────────────────────────────────────────────────
# Frame field computation
# ──────────────────────────────────────────────────────────────────────

def compute_frame_field_from_mask(binary_mask: np.ndarray) -> np.ndarray:
    """Derive a frame field from a binary building mask.

    Uses the gradient of the signed distance field: the gradient direction
    is perpendicular to the nearest boundary, and the 90° rotation gives
    the tangent direction.  Together they form the two-direction frame.

    Returns:
        (4, H, W) float32 array — [cos 2θ₁, sin 2θ₁, cos 2θ₂, sin 2θ₂]
    """
    mask_u8 = (binary_mask > 0).astype(np.uint8)

    dist_in = cv2.distanceTransform(mask_u8, cv2.DIST_L2, 5).astype(np.float64)
    dist_out = cv2.distanceTransform(1 - mask_u8, cv2.DIST_L2, 5).astype(np.float64)
    sdf = dist_in - dist_out

    grad_y = ndimage.sobel(sdf, axis=0)
    grad_x = ndimage.sobel(sdf, axis=1)

    theta = np.arctan2(grad_y, grad_x)  # normal direction
    theta_t = theta + np.pi / 2          # tangent direction

    ff = np.stack(
        [np.cos(2 * theta), np.sin(2 * theta),
         np.cos(2 * theta_t), np.sin(2 * theta_t)],
        axis=0,
    )
    return ff.astype(np.float32)


# ──────────────────────────────────────────────────────────────────────
# Contour → raw polygons
# ──────────────────────────────────────────────────────────────────────

def extract_raw_polygons(binary_mask: np.ndarray, min_area: float = 100) -> list[Polygon]:
    """Contour-trace a binary mask into Shapely polygons (pixel coords)."""
    mask_u8 = (binary_mask > 0.5).astype(np.uint8) * 255

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, hierarchy = cv2.findContours(mask_u8, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    hierarchy = hierarchy[0]

    polygons: list[Polygon] = []
    for i, cnt in enumerate(contours):
        if len(cnt) < 4 or hierarchy[i][3] != -1:   # skip inner contours
            continue
        coords = [(float(pt[0][0]), float(pt[0][1])) for pt in cnt]
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        try:
            poly = make_valid(Polygon(coords))
            if isinstance(poly, MultiPolygon):
                polygons.extend(p for p in poly.geoms if p.area >= min_area)
            elif poly.area >= min_area:
                polygons.append(poly)
        except Exception:
            continue
    return polygons


# ──────────────────────────────────────────────────────────────────────
# Dominant-angle estimation from the frame field
# ──────────────────────────────────────────────────────────────────────

def _rasterize_polygon(polygon: Polygon, bbox: tuple[int, int, int, int]) -> np.ndarray:
    """Rasterize a polygon into a boolean mask over *bbox* (minx, miny, maxx, maxy)."""
    minx, miny, maxx, maxy = bbox
    h, w = maxy - miny + 1, maxx - minx + 1
    pts = np.array(polygon.exterior.coords, dtype=np.int32)
    pts[:, 0] -= minx
    pts[:, 1] -= miny
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 1)
    return mask.astype(bool)


def _dominant_angle(polygon: Polygon, frame_field: np.ndarray) -> float:
    """Return the dominant building orientation θ ∈ [0, π/2) from the frame field."""
    H, W = frame_field.shape[1], frame_field.shape[2]
    minx, miny, maxx, maxy = (int(v) for v in polygon.bounds)
    minx, miny = max(0, minx), max(0, miny)
    maxx, maxy = min(W - 1, maxx), min(H - 1, maxy)

    cos2 = frame_field[0, miny : maxy + 1, minx : maxx + 1]
    sin2 = frame_field[1, miny : maxy + 1, minx : maxx + 1]

    mask = _rasterize_polygon(polygon, (minx, miny, maxx, maxy))
    # trim mask to actual array shape (in case polygon slightly exceeds bounds)
    mask = mask[: cos2.shape[0], : cos2.shape[1]]
    if not mask.any():
        mask = np.ones_like(cos2, dtype=bool)

    mean_c = float(np.mean(cos2[mask]))
    mean_s = float(np.mean(sin2[mask]))
    angle = np.arctan2(mean_s, mean_c) / 2.0
    return angle % (np.pi / 2)


# ──────────────────────────────────────────────────────────────────────
# Edge snapping + vertex reconstruction
# ──────────────────────────────────────────────────────────────────────

def _angle_diff(a: float, b: float) -> float:
    """Absolute angular difference wrapped to [0, π]."""
    d = (a - b) % (2 * np.pi)
    return min(d, 2 * np.pi - d)


def _snap_angle(angle: float, dominant: float, tolerance: float = np.pi / 6) -> float:
    """Snap *angle* to the closest of the four canonical directions."""
    allowed = [dominant + k * np.pi / 2 for k in range(4)]
    diffs = [_angle_diff(angle, a) for a in allowed]
    best = int(np.argmin(diffs))
    return allowed[best] if diffs[best] <= tolerance else angle


def _line_intersection(p1, a1, p2, a2):
    """Intersection of two directed lines (point + angle).  Returns None if parallel."""
    c1, s1 = np.cos(a1), np.sin(a1)
    c2, s2 = np.cos(a2), np.sin(a2)
    det = c1 * s2 - s1 * c2
    if abs(det) < 1e-10:
        return None
    t = ((p2[0] - p1[0]) * s2 - (p2[1] - p1[1]) * c2) / det
    return (p1[0] + t * c1, p1[1] + t * s1)


# ──────────────────────────────────────────────────────────────────────
# Single-polygon regularization
# ──────────────────────────────────────────────────────────────────────

def regularize_polygon(
    polygon: Polygon,
    frame_field: np.ndarray,
    simplify_tolerance: float = 2.0,
) -> Polygon:
    """Regularize one building polygon: snap edges → square corners.

    Steps:
        1. Douglas-Peucker simplification.
        2. Frame-field dominant-angle estimation.
        3. Snap each edge to the nearest canonical angle (dominant ± k·90°).
        4. Reconstruct vertices as intersections of adjacent snapped edges.
    """
    if polygon.area < 50:
        return polygon

    simplified = polygon.simplify(simplify_tolerance, preserve_topology=True)
    if not isinstance(simplified, Polygon) or simplified.is_empty:
        return polygon

    coords = list(simplified.exterior.coords)
    n = len(coords) - 1  # last == first
    if n < 4:
        return simplified

    dominant = _dominant_angle(polygon, frame_field)

    # Build snapped edges (midpoint + angle)
    edges = []
    for i in range(n):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        mid = ((x1 + x2) / 2, (y1 + y2) / 2)
        angle = np.arctan2(y2 - y1, x2 - x1)
        edges.append((mid, _snap_angle(angle, dominant)))

    # Reconstruct vertices from adjacent-edge intersections
    new_coords = []
    for i in range(n):
        mid1, a1 = edges[i]
        mid2, a2 = edges[(i + 1) % n]
        pt = _line_intersection(mid1, a1, mid2, a2)
        new_coords.append(pt if pt is not None else coords[i + 1])

    new_coords.append(new_coords[0])

    try:
        result = make_valid(Polygon(new_coords))
        if isinstance(result, MultiPolygon):
            result = max(result.geoms, key=lambda p: p.area)
        if result.is_empty or not result.is_valid:
            return simplified
        return result
    except Exception:
        return simplified


# ──────────────────────────────────────────────────────────────────────
# Batch API
# ──────────────────────────────────────────────────────────────────────

def regularize_buildings(
    binary_mask: np.ndarray,
    frame_field: np.ndarray | None = None,
    min_area: float = 100,
    simplify_tolerance: float = 2.0,
) -> list[Polygon]:
    """Extract and regularize all building polygons from a segmentation mask.

    If *frame_field* is not provided it is derived from the mask itself.
    """
    if frame_field is None:
        frame_field = compute_frame_field_from_mask(binary_mask)

    raw = extract_raw_polygons(binary_mask, min_area=min_area)

    return [
        regularize_polygon(p, frame_field, simplify_tolerance)
        for p in raw
    ]
