# Building Footprint Extraction

Extracts building polygons from satellite GeoTIFFs using **U-Net / HRNet segmentation** followed by **Frame Field Regularization** to produce clean, squared-corner footprints.

## Pipeline

```
GeoTIFF ──► Tiled U-Net/HRNet inference ──► probability mask
         ──► Frame field computation     ──► dominant-angle estimation
         ──► Edge snapping + vertex reconstruction ──► GeoJSON polygons
```

## Setup

```bash
pip install -r buildings/requirements.txt
```

For GPU inference install the CUDA version of PyTorch **before** the above:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

## Usage

### Inference (with pre-trained weights)

```bash
python -m buildings.extract IMAGE.tif -o buildings.geojson --weights model.pth
```

Key options:

| Flag | Default | Description |
|------|---------|-------------|
| `--encoder` | `resnet34` | Backbone (`resnet50`, `tu-hrnet_w18`, `tu-hrnet_w32`, …) |
| `--model-type` | `seg` | `seg` = binary segmentation; `ff` = frame-field model |
| `--threshold` | `0.5` | Segmentation probability cutoff |
| `--min-area` | `100` | Minimum polygon area in pixels |
| `--simplify` | `2.0` | Douglas-Peucker tolerance before regularization |
| `--tile-size` | `512` | Inference tile size |
| `--device` | auto | `cpu` or `cuda` |

### Training on SpaceNet

Expects the standard SpaceNet v2 Buildings layout:

```
spacenet/
├── images/               *.tif
└── geojson_buildings/    *.geojson
```

```bash
python -m buildings.train spacenet/ -o weights/best.pth --encoder resnet34 --epochs 40
```

Then run inference with the resulting weights:

```bash
python -m buildings.extract IMAGE.tif --weights weights/best.pth -o buildings.geojson
```

## Frame Field Regularization

The regularization algorithm (inspired by Girard et al., *Polygonization by Frame Field Learning*, 2021):

1. **Signed distance field** — computed from the binary segmentation mask.
2. **Frame field** — gradient of the SDF gives edge-perpendicular directions; 90° rotation gives edge-tangent directions. Together they form a two-direction frame at every pixel.
3. **Dominant angle** — the average frame direction inside each building determines the main axis.
4. **Edge snapping** — each polygon edge is snapped to the nearest canonical angle (dominant ± k·90°).
5. **Vertex reconstruction** — new vertices are placed at the intersections of adjacent snapped edges, producing clean right-angle corners.

When a frame-field model (`--model-type ff`) is used, the learned frame field replaces step 2 for higher accuracy.
