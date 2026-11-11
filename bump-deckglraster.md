# Testing the deck.gl-raster 0.10 bump locally

This branch moves `@developmentseed/deck.gl-geotiff`, `deck.gl-raster` and
`geotiff` from 0.9 to 0.10, migrates to the new `source` / `data` APIs, and
replaces our chunkd-based COG loader (`src/utils/geotiff.ts`) with the
library's range reader (`GeoTIFF.fromUrl` / `COGSource.open`).

## Setup

The project pins Yarn 1.22.22 (`packageManager` in `package.json`). If an
untracked `.yarnrc.yml` or `.yarn/` is in the checkout, plain `yarn` runs
Yarn 4 and rewrites `yarn.lock`. Either delete those files, or call Yarn 1
explicitly:

```sh
git switch bump-deckglraster
npx yarn@1.22.22 install
```

(The commands below use `yarn`; substitute `npx yarn@1.22.22` if needed.)

## Automated checks

All of these passed when the branch was made:

```sh
yarn lint           # 0 errors (warnings were already there)
yarn format:check
yarn test           # vitest
yarn build          # tsc -b && vite build
yarn build:lib      # library build
```

## Manual checks in the browser

```sh
yarn dev
```

Open <http://localhost:5173/stac-map/>, and pass a STAC URL with `?href=...`.
Open DevTools → Network to watch the requests.

1. **Single COG asset**: open a STAC item with a COG asset and pick the asset
   in the Visualization section. It should draw, and single-band greyscale
   COGs should still be rescaled sensibly.
2. **Item mosaic**: open a collection or search with many COG items and pick
   an `items:<asset>` visualization. Items should draw as you pan, and items
   panned out of view should come back when you return.
3. **Request coalescing**: in the Network tab, tile reads should arrive as
   fewer, larger range requests than on `main`, with no more than 6 in flight
   per origin.
4. **Regression check for #459** (image disappears once zoomed in fully). We
   used to send a HEAD request first to work around the chunkd
   `Content-Range` bug behind it, and that workaround is gone now. Open
   <http://localhost:5173/stac-map/?href=https://maxar-opendata.s3.dualstack.us-west-2.amazonaws.com/events/NWT-Canada-Aug-23/ard/11/013331213032/2023-08-21/104001008A8DAA00.json>,
   click zoom to extent on the item, and check the image stays visible at
   full zoom.

To compare against the old behaviour, run the same steps on `main`.
