#!/usr/bin/env python
"""Extract building footprints from a satellite GeoTIFF.

Pipeline
--------
1. U-Net / HRNet segmentation  → probability mask
2. Frame Field Regularization   → squared GeoJSON polygons

Usage
-----
    python -m buildings.extract IMAGE.tif -o buildings.geojson
    python -m buildings.extract IMAGE.tif --weights model.pth --encoder tu-hrnet_w18
"""

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from shapely.geometry import mapping, shape
from shapely.ops import transform as shapely_transform

from .model import load_model
from .inference import TiledPredictor
from .regularize import regularize_buildings


def _pixel_to_crs(geom, raster_transform):
    """Convert a Shapely geometry from pixel coordinates to the raster's CRS."""

    def _affine(x, y):
        # rasterio Affine: col/row → x/y
        nx, ny = raster_transform * (x, y)
        return nx, ny

    return shapely_transform(_affine, geom)


def run(
    tif_path: str,
    output_path: str = "buildings.geojson",
    weights_path: str | None = None,
    model_type: str = "seg",
    encoder_name: str = "resnet34",
    tile_size: int = 512,
    overlap: int = 64,
    batch_size: int = 4,
    threshold: float = 0.5,
    min_area: float = 100,
    simplify_tolerance: float = 2.0,
    device: str | None = None,
):
    tif_path = str(Path(tif_path).resolve())

    print(f"Loading model  (encoder={encoder_name}, type={model_type}) …")
    model = load_model(
        weights_path=weights_path,
        model_type=model_type,
        encoder_name=encoder_name,
    )

    predictor = TiledPredictor(
        model,
        tile_size=tile_size,
        overlap=overlap,
        batch_size=batch_size,
        device=device,
    )

    print(f"Running inference on {tif_path} …")
    seg_map, frame_field, meta = predictor.predict(tif_path)

    binary = (seg_map >= threshold).astype(np.uint8)
    print(f"Segmentation done — {binary.sum():,} positive pixels")

    print("Extracting & regularizing polygons (Frame Field Regularization) …")
    polygons = regularize_buildings(
        binary,
        frame_field=frame_field,
        min_area=min_area,
        simplify_tolerance=simplify_tolerance,
    )
    print(f"  {len(polygons)} buildings extracted")

    if not polygons:
        print("No buildings found — exiting.")
        sys.exit(0)

    # Convert pixel polygons → CRS coordinates
    crs_polys = [_pixel_to_crs(p, meta["transform"]) for p in polygons]

    gdf = gpd.GeoDataFrame(
        {"geometry": crs_polys, "area_m2": [p.area for p in crs_polys]},
        crs=meta["crs"],
    )
    gdf.to_file(output_path, driver="GeoJSON")
    print(f"Saved {len(gdf)} buildings → {output_path}")


def main():
    ap = argparse.ArgumentParser(
        description="Extract building footprints with U-Net/HRNet + Frame Field Regularization."
    )
    ap.add_argument("image", help="Input GeoTIFF path")
    ap.add_argument("-o", "--output", default="buildings.geojson", help="Output GeoJSON path")
    ap.add_argument("--weights", default=None, help="Path to trained .pth weights")
    ap.add_argument("--model-type", choices=["seg", "ff"], default="seg",
                     help="'seg' = binary segmentation; 'ff' = frame-field model")
    ap.add_argument("--encoder", default="resnet34",
                     help="Encoder backbone (resnet34, resnet50, tu-hrnet_w18, …)")
    ap.add_argument("--tile-size", type=int, default=512)
    ap.add_argument("--overlap", type=int, default=64)
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--min-area", type=float, default=100,
                     help="Minimum building area in pixels")
    ap.add_argument("--simplify", type=float, default=2.0,
                     help="Douglas-Peucker tolerance for initial simplification")
    ap.add_argument("--device", default=None, help="Force device (cpu / cuda / cuda:0)")

    args = ap.parse_args()
    run(
        tif_path=args.image,
        output_path=args.output,
        weights_path=args.weights,
        model_type=args.model_type,
        encoder_name=args.encoder,
        tile_size=args.tile_size,
        overlap=args.overlap,
        batch_size=args.batch_size,
        threshold=args.threshold,
        min_area=args.min_area,
        simplify_tolerance=args.simplify,
        device=args.device,
    )


if __name__ == "__main__":
    main()
