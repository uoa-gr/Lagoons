#!/usr/bin/env python
"""Train a U-Net / HRNet building-segmentation model on SpaceNet data.

Expected directory layout (SpaceNet v2 Buildings format)::

    spacenet/
    ├── images/          *.tif  (3-/8-band pan-sharpened chips, 650×650)
    └── geojson_buildings/  *.geojson  (per-chip building footprints)

Usage
-----
    python -m buildings.train spacenet/ -o weights/best.pth
    python -m buildings.train spacenet/ --encoder tu-hrnet_w18 --epochs 60
"""

import argparse
from pathlib import Path

import cv2
import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize
from shapely.geometry import shape
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
from tqdm import tqdm

from .model import BuildingSegModel, BuildingFrameFieldModel


# ──────────────────────────────────────────────────────────────────────
# Dataset
# ──────────────────────────────────────────────────────────────────────

_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class SpaceNetDataset(Dataset):
    """Reads SpaceNet v2 image chips + GeoJSON labels."""

    def __init__(self, root: str, tile_size: int = 512, augment: bool = True):
        self.root = Path(root)
        self.tile_size = tile_size
        self.augment = augment

        img_dir = self.root / "images"
        lbl_dir = self.root / "geojson_buildings"
        if not img_dir.exists():
            raise FileNotFoundError(f"Missing images dir: {img_dir}")

        self.image_paths = sorted(img_dir.glob("*.tif"))
        # Map image stem → label path
        self.label_map = {}
        if lbl_dir.exists():
            for p in lbl_dir.glob("*.geojson"):
                # SpaceNet naming: buildings_AOI_*_img123.geojson
                stem = p.stem.replace("buildings_", "").replace("geojson_buildings_", "")
                self.label_map[stem] = p
        # Also try direct stem matching
        for p in self.image_paths:
            if p.stem not in self.label_map:
                candidate = lbl_dir / f"{p.stem}.geojson"
                if candidate.exists():
                    self.label_map[p.stem] = candidate

    def __len__(self):
        return len(self.image_paths)

    def __getitem__(self, idx):
        img_path = self.image_paths[idx]

        with rasterio.open(img_path) as src:
            n_bands = min(src.count, 3)
            img = src.read(list(range(1, n_bands + 1))).astype(np.float32) / 255.0
            transform = src.transform
            h, w = src.height, src.width

        # Rasterize building footprints
        mask = np.zeros((h, w), dtype=np.uint8)
        stem = img_path.stem
        label_path = self.label_map.get(stem)
        if label_path:
            gdf = gpd.read_file(label_path)
            if not gdf.empty:
                shapes = [(geom, 1) for geom in gdf.geometry if geom is not None and geom.is_valid]
                if shapes:
                    mask = rasterize(shapes, out_shape=(h, w), transform=transform, dtype=np.uint8)

        # Random crop to tile_size
        if h > self.tile_size or w > self.tile_size:
            y = np.random.randint(0, max(1, h - self.tile_size))
            x = np.random.randint(0, max(1, w - self.tile_size))
            img = img[:, y : y + self.tile_size, x : x + self.tile_size]
            mask = mask[y : y + self.tile_size, x : x + self.tile_size]

        # Pad if smaller
        if img.shape[1] < self.tile_size or img.shape[2] < self.tile_size:
            padded_img = np.zeros((img.shape[0], self.tile_size, self.tile_size), dtype=np.float32)
            padded_mask = np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
            padded_img[:, : img.shape[1], : img.shape[2]] = img
            padded_mask[: mask.shape[0], : mask.shape[1]] = mask
            img, mask = padded_img, padded_mask

        # Normalise
        for c in range(img.shape[0]):
            img[c] = (img[c] - _MEAN[c]) / _STD[c]

        # Augmentation
        if self.augment:
            if np.random.rand() > 0.5:
                img = img[:, :, ::-1].copy()
                mask = mask[:, ::-1].copy()
            if np.random.rand() > 0.5:
                img = img[:, ::-1, :].copy()
                mask = mask[::-1, :].copy()

        return torch.from_numpy(img), torch.from_numpy(mask.astype(np.float32)).unsqueeze(0)


# ──────────────────────────────────────────────────────────────────────
# Training loop
# ──────────────────────────────────────────────────────────────────────

def dice_loss(pred, target, smooth=1.0):
    pred_flat = pred.reshape(-1)
    target_flat = target.reshape(-1)
    intersection = (pred_flat * target_flat).sum()
    return 1 - (2.0 * intersection + smooth) / (pred_flat.sum() + target_flat.sum() + smooth)


def train(
    data_root: str,
    output_path: str = "best.pth",
    encoder_name: str = "resnet34",
    tile_size: int = 512,
    epochs: int = 40,
    batch_size: int = 8,
    lr: float = 1e-4,
    val_split: float = 0.15,
    device: str | None = None,
):
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    dataset = SpaceNetDataset(data_root, tile_size=tile_size, augment=True)
    val_n = max(1, int(len(dataset) * val_split))
    train_n = len(dataset) - val_n
    train_ds, val_ds = random_split(dataset, [train_n, val_n])
    val_ds.dataset.augment = False  # type: ignore[attr-defined]

    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=2, pin_memory=True)
    val_dl = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=2, pin_memory=True)

    model = BuildingSegModel(encoder_name=encoder_name, encoder_weights="imagenet").to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    bce = nn.BCELoss()

    best_val = float("inf")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        # ---- train ----
        model.train()
        train_loss = 0.0
        for imgs, masks in tqdm(train_dl, desc=f"Epoch {epoch}/{epochs} [train]", leave=False):
            imgs, masks = imgs.to(device), masks.to(device)
            pred = model(imgs)["seg"]
            loss = bce(pred, masks) + dice_loss(pred, masks)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * imgs.size(0)
        train_loss /= train_n

        # ---- val ----
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for imgs, masks in val_dl:
                imgs, masks = imgs.to(device), masks.to(device)
                pred = model(imgs)["seg"]
                loss = bce(pred, masks) + dice_loss(pred, masks)
                val_loss += loss.item() * imgs.size(0)
        val_loss /= val_n
        scheduler.step()

        print(f"Epoch {epoch:3d}  train_loss={train_loss:.4f}  val_loss={val_loss:.4f}")

        if val_loss < best_val:
            best_val = val_loss
            torch.save(model.state_dict(), output_path)
            print(f"  ↳ saved {output_path}")

    print(f"Training complete.  Best val loss: {best_val:.4f}")


def main():
    ap = argparse.ArgumentParser(description="Train building segmentation on SpaceNet data.")
    ap.add_argument("data", help="Path to SpaceNet dataset root (images/ + geojson_buildings/)")
    ap.add_argument("-o", "--output", default="weights/best.pth", help="Output weights path")
    ap.add_argument("--encoder", default="resnet34")
    ap.add_argument("--tile-size", type=int, default=512)
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()
    train(
        data_root=args.data,
        output_path=args.output,
        encoder_name=args.encoder,
        tile_size=args.tile_size,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        device=args.device,
    )


if __name__ == "__main__":
    main()
