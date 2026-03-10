"""Building segmentation models: U-Net and HRNet with optional frame field head."""

import torch
import torch.nn as nn
import segmentation_models_pytorch as smp


class BuildingSegModel(nn.Module):
    """Standard U-Net / HRNet for binary building segmentation.

    Uses segmentation_models_pytorch under the hood. Any smp-compatible
    encoder works (resnet34, resnet50, efficientnet-b3, tu-hrnet_w18, …).

    Output dict:
        seg – (B, 1, H, W) sigmoid probabilities
    """

    def __init__(self, encoder_name="resnet34", encoder_weights="imagenet", in_channels=3):
        super().__init__()
        self.net = smp.Unet(
            encoder_name=encoder_name,
            encoder_weights=encoder_weights,
            in_channels=in_channels,
            classes=1,
            activation=None,
        )

    def forward(self, x):
        return {"seg": torch.sigmoid(self.net(x))}


class BuildingFrameFieldModel(nn.Module):
    """U-Net with a frame-field prediction head.

    Outputs six channels:
        0   – interior segmentation logit
        1   – edge segmentation logit
        2-5 – frame field (cos 2θ₁, sin 2θ₁, cos 2θ₂, sin 2θ₂)

    Output dict:
        seg       – (B, 1, H, W) interior probabilities
        seg_edge  – (B, 1, H, W) edge probabilities
        frame_field – (B, 4, H, W) unit-normalised frame directions
    """

    def __init__(self, encoder_name="resnet34", encoder_weights="imagenet", in_channels=3):
        super().__init__()
        self.net = smp.Unet(
            encoder_name=encoder_name,
            encoder_weights=encoder_weights,
            in_channels=in_channels,
            classes=6,
            activation=None,
        )

    def forward(self, x):
        out = self.net(x)

        seg_interior = torch.sigmoid(out[:, 0:1])
        seg_edge = torch.sigmoid(out[:, 1:2])

        ff_raw = out[:, 2:6]
        ff1 = ff_raw[:, 0:2]
        ff2 = ff_raw[:, 2:4]
        ff1 = ff1 / (ff1.norm(dim=1, keepdim=True) + 1e-8)
        ff2 = ff2 / (ff2.norm(dim=1, keepdim=True) + 1e-8)

        return {
            "seg": seg_interior,
            "seg_edge": seg_edge,
            "frame_field": torch.cat([ff1, ff2], dim=1),
        }


def load_model(weights_path=None, model_type="seg", encoder_name="resnet34", in_channels=3):
    """Instantiate a model and optionally load trained weights.

    Args:
        weights_path: Path to a .pth state-dict file.  When *None* the encoder
            keeps its ImageNet initialisation (useful for pipeline testing).
        model_type: ``"seg"`` for binary segmentation, ``"ff"`` for the
            frame-field variant.
        encoder_name: Any encoder accepted by *segmentation_models_pytorch*
            (e.g. ``resnet34``, ``tu-hrnet_w18``).
        in_channels: 3 for RGB, 4 for RGBN, etc.
    """
    cls = BuildingFrameFieldModel if model_type == "ff" else BuildingSegModel

    if weights_path:
        model = cls(encoder_name=encoder_name, encoder_weights=None, in_channels=in_channels)
        state_dict = torch.load(weights_path, map_location="cpu", weights_only=True)
        model.load_state_dict(state_dict)
    else:
        model = cls(encoder_name=encoder_name, encoder_weights="imagenet", in_channels=in_channels)

    model.eval()
    return model
