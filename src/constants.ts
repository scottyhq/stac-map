export interface Example {
  title: string;
  badge: string;
  href: string;
}

export const EXAMPLES: Example[] = [
  {
    title: "NSIDC-0723 S1 backscatter mosaics",
    badge: "stac-geoparquet",
    href: "https://s3.kopah.uw.edu/gaia/public/grimp/nsidc-0723/v04/nsidc-0723.parquet",
  },
  {
    title: "NSIDC-0725 annual velocity mosaics",
    badge: "stac-geoparquet",
    href: "https://s3.kopah.uw.edu/gaia/public/grimp/nsidc-0725/v05/nsidc-0725.parquet",
  },
  {
    title: "NSIDC-0481 TSX/TDX glacier site velocity",
    badge: "stac-geoparquet",
    href: "https://s3.kopah.uw.edu/gaia/public/grimp/nsidc-0481/v04/nsidc-0481.parquet",
  },
];
