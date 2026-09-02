# FFmpeg and aria2 binaries and source record

Snag's Windows package contains `ffmpeg.exe` from the **FFmpeg 8.0.1
essentials build by gyan.dev**. The binary is a separate command-line program;
it is not linked into Snag.

## Exact binary

- Provider release: <https://github.com/GyanD/codexffmpeg/releases/tag/8.0.1>
- Archive: `ffmpeg-8.0.1-essentials_build.zip`
- Archive SHA-256: `e2aaeaa0fdbc397d4794828086424d4aaa2102cef1fb6874f6ffd29c0b88b673`
- Extracted `ffmpeg.exe` SHA-256:
  `5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d`
- Exact version, configuration, enabled components, and external-library
  versions: `ffmpeg-BUILD-README.txt`, extracted unchanged from that verified
  archive.

`TOOLS_MANIFEST.json` is the machine-readable authority used by the build.

## License

This gyan.dev build is a 64-bit static **GPL version 3** build. It was compiled
with `--enable-gpl --enable-version3` and GPL-covered libraries including x264
and x265. The complete license text supplied in the provider's archive is
included unchanged as `ffmpeg-COPYING.GPLv3.txt`.

Snag and FFmpeg are separate programs distributed together as an aggregate.
FFmpeg's GPL does not relicense Snag, but it does impose obligations on whoever
distributes the FFmpeg binary.

## Exact FFmpeg source

- Commit: `894da5ca7d742e4429ffb2af534fcda0103ef593`
- Source tree:
  <https://github.com/FFmpeg/FFmpeg/tree/894da5ca7d742e4429ffb2af534fcda0103ef593>
- Git retrieval:

  ```text
  git clone https://github.com/FFmpeg/FFmpeg.git
  git -C FFmpeg checkout 894da5ca7d742e4429ffb2af534fcda0103ef593
  ```

The provider's `ffmpeg-BUILD-README.txt` records the compiler, complete FFmpeg
configuration, and exact versions of the statically linked dependencies.

## aria2

Snag's package also contains `aria2c.exe` from the upstream **aria2 1.37.0
win-64bit-build1** release, used as yt-dlp's external downloader when the
"aria2" engine is selected. It is a separate command-line program.

- Release: <https://github.com/aria2/aria2/releases/tag/release-1.37.0>
- Archive: `aria2-1.37.0-win-64bit-build1.zip`
- Archive SHA-256: `67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288`
- Extracted `aria2c.exe` SHA-256:
  `be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2`
- License: GPL-2.0-or-later with the OpenSSL exception (`aria2-COPYING.txt`)
- Exact source: <https://github.com/aria2/aria2/tree/release-1.37.0>; the
  archive's `README.mingw` lists the statically linked dependencies of the
  upstream Windows build.

The same Corresponding Source obligation described below applies to this
binary.

## Distribution requirement

The GPL requires access to the complete Corresponding Source for the exact
object code being distributed. For this static build, that means the FFmpeg
source plus the enabled external-library sources and the material needed to
control the build. A link to the FFmpeg repository alone is not enough.

Before publishing a Snag installer or portable executable, the release owner
must make a matching Corresponding Source archive available at no charge next
to the binary release (or use another GPL-compliant conveyance method), with
clear directions from the release page. That archive must cover the exact
dependency versions listed in `ffmpeg-BUILD-README.txt` and remain available
for as long as the binary is offered. The checked-in manifest and notices make
the binary reproducible and identify the obligation; they do not by themselves
replace the Corresponding Source archive.

For FFmpeg's own compliance guidance, see <https://ffmpeg.org/legal.html>.
