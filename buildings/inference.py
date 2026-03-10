"""Tiled inference on large GeoTIFFs with overlap blending."""

import numpy as np
import rasterio
import torch
from tqdm import tqdm


# ImageNet statistics used by torchvision / smp pre-trained encoders
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)


class TiledPredictor:
    """Run a building-segmentation model on a large GeoTIFF tile-by-tile.

    Handles:
    * windowed reading (memory-efficient for huge images)
    * overlap + Gaussian-ramp blending between adjacent tiles
    * optional frame-field output merging
    """

    def __init__(self, model, tile_size=512, overlap=64, batch_size=4, device=None):
        self.model = model
        self.tile_size = tile_size
        self.overlap = overlap
        self.batch_size = batch_size
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)

    # ------------------------------------------------------------------
    # public
    # ------------------------------------------------------------------

    def predict(self, tif_path):
        """Return ``(seg_map, frame_field | None, meta)`` for the whole image.

        *seg_map* is a float32 array of shape ``(H, W)`` in [0, 1].
        *frame_field* is ``(4, H, W)`` when the model provides it, else *None*.
        *meta* is a dict with keys ``crs``, ``transform``, ``height``, ``width``.
        """
        with rasterio.open(tif_path) as src:
            crs = src.crs
            transform = src.transform
            height, width = src.height, src.width
            n_bands = min(src.count, 3)

            meta = {"crs": crs, "transform": transform, "height": height, "width": width}

            # Allocate output buffers
            seg_acc = np.zeros((height, width), dtype=np.float64)
            wgt_acc = np.zeros((height, width), dtype=np.float64)
            ff_acc = None
            has_ff = False

            tiles = list(self._tile_positions(height, width))
            batches = [tiles[i : i + self.batch_size] for i in range(0, len(tiles), self.batch_size)]

            for batch_pos in tqdm(batches, desc="Inference", unit="batch"):
                images = []
                for (y, x, h, w) in batch_pos:
                    win = rasterio.windows.Window(col_off=x, row_off=y, width=w, height=h)
                    tile = src.read(list(range(1, n_bands + 1)), window=win).astype(np.float32) / 255.0
                    tile = (tile - _MEAN[:n_bands]) / _STD[:n_bands]
                    # pad to tile_size
                    padded = np.zeros((n_bands, self.tile_size, self.tile_size), dtype=np.float32)
                    padded[:, :h, :w] = tile
                    images.append(padded)

                batch_t = torch.from_numpy(np.stack(images)).to(self.device)
                with torch.no_grad():
                    out = self.model(batch_t)

                seg_b = out["seg"].cpu().numpy()[:, 0]  # (B, H, W)
                ff_b = out.get("frame_field")
                if ff_b is not None:
                    has_ff = True
                    ff_b = ff_b.cpu().numpy()
                    if ff_acc is None:
                        ff_acc = np.zeros((4, height, width), dtype=np.float64)

                for idx, (y, x, h, w) in enumerate(batch_pos):
                    blend = self._blend_weights(h, w)
                    seg_acc[y : y + h, x : x + w] += seg_b[idx, :h, :w] * blend
                    wgt_acc[y : y + h, x : x + w] += blend
                    if has_ff:
                        for c in range(4):
                            ff_acc[c, y : y + h, x : x + w] += ff_b[idx, c, :h, :w] * blend

        mask = wgt_acc > 0
        seg_acc[mask] /= wgt_acc[mask]
        if ff_acc is not None:
            for c in range(4):
                ff_acc[c][mask] /= wgt_acc[mask]
            ff_acc = ff_acc.astype(np.float32)

        return seg_acc.astype(np.float32), ff_acc, meta

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    def _tile_positions(self, height, width):
        step = self.tile_size - self.overlap
        for y in range(0, height, step):
            for x in range(0, width, step):
                y1 = min(y, max(0, height - self.tile_size))
                x1 = min(x, max(0, width - self.tile_size))
                h = min(self.tile_size, height - y1)
                w = min(self.tile_size, width - x1)
                yield y1, x1, h, w

    def _blend_weights(self, h, w):
        ramp = min(self.overlap // 2, 16)
        weight = np.ones((h, w), dtype=np.float32)
        for i in range(ramp):
            v = (i + 1) / (ramp + 1)
            weight[i, :] = np.minimum(weight[i, :], v)
            weight[h - 1 - i, :] = np.minimum(weight[h - 1 - i, :], v)
            weight[:, i] = np.minimum(weight[:, i], v)
            weight[:, w - 1 - i] = np.minimum(weight[:, w - 1 - i], v)
        return weight
