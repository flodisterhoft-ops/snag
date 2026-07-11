# Included automatically by electron-builder's NSIS template (customHeader is
# inserted at top-level script scope in installer.nsi).

!macro customHeader
  # Declare the installer DPI-aware so Windows renders it at native resolution
  # on high-DPI displays instead of bitmap-stretching a 96-DPI window (blurry
  # setup screens on 4K monitors).
  ManifestDPIAware true
!macroend
