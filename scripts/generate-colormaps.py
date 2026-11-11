"""Generate src/utils/colormap-luts.ts from matplotlib colormaps.

    uvx --with matplotlib --with numpy python scripts/generate-colormaps.py src/utils/colormap-luts.ts
"""
import base64, sys
import numpy as np
import matplotlib

NAMES = ["viridis", "plasma", "inferno", "magma", "cividis", "turbo",
         "terrain", "coolwarm", "RdBu", "Spectral", "YlGnBu"]
out = ["// Generated from matplotlib %s colormaps (256 RGB entries each, base64)." % matplotlib.__version__,
       "// Do not edit by hand; regenerate with scripts/generate-colormaps.py.",
       "export const COLORMAP_LUTS = {"]
for name in NAMES:
    cmap = matplotlib.colormaps[name]
    rgb = (np.asarray(cmap(np.linspace(0, 1, 256)))[:, :3] * 255).round().astype(np.uint8)
    out.append('  %s: "%s",' % (name.lower(), base64.b64encode(rgb.tobytes()).decode()))
out.append("} as const;")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
