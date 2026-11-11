import { StacIcon } from "@/components/ui/stac";
import { useStacGeoparquetValue, useStacValue } from "@/hooks/stac";
import { useStore } from "@/store";
import type { StacValue } from "@/types/stac";
import { getLink, getStacTitle, getStacType } from "@/utils/stac";
import { Breadcrumb, HStack } from "@chakra-ui/react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { useMemo } from "react";
import type { StacLink } from "stac-ts";

export default function Breadcrumbs({ value }: { value: StacValue }) {
  const href = useStore((store) => store.href);
  const hrefIsParquet = useStore((store) => store.hrefIsParquet);
  const stacGeoparquetId = useStore((store) => store.stacGeoparquetId);
  const connection = useStore((store) => store.connection);

  // An item selected from a stac-geoparquet file belongs to that file's
  // collection, so link back to the file-level view instead of following the
  // item's own links, which may be relative or not URLs at all.
  const isGeoparquetItem =
    hrefIsParquet && !!stacGeoparquetId && value.type === "Feature";

  return (
    <Breadcrumb.Root size={"sm"}>
      <Breadcrumb.List flexWrap="wrap">
        {isGeoparquetItem && href && connection ? (
          <GeoparquetCollectionBreadcrumbLink
            href={href}
            connection={connection}
          />
        ) : (
          getBreadcrumbLink(value)
        )}
        <Breadcrumb.Item>
          <Breadcrumb.CurrentLink>
            <HStack whiteSpace="nowrap">{getStacType(value)}</HStack>
          </Breadcrumb.CurrentLink>
        </Breadcrumb.Item>
      </Breadcrumb.List>
    </Breadcrumb.Root>
  );
}

function BreadcrumbLink({
  link,
  root = false,
}: {
  link: StacLink;
  root?: boolean;
}) {
  const setHref = useStore((store) => store.setHref);
  const result = useStacValue({ href: link.href });
  const text = useMemo(() => {
    return result.data ? (
      <HStack gap={1} whiteSpace="nowrap">
        <StacIcon value={result.data} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {getStacTitle(result.data)}
        </span>
      </HStack>
    ) : (
      link.rel.charAt(0).toUpperCase() + link.rel.slice(1)
    );
  }, [result.data, link.rel]);

  return (
    <>
      {result.data && !root && getBreadcrumbLink(result.data)}
      <Breadcrumb.Item>
        <Breadcrumb.Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setHref(link.href);
          }}
        >
          {text}
        </Breadcrumb.Link>
      </Breadcrumb.Item>
      <Breadcrumb.Separator />
    </>
  );
}

function GeoparquetCollectionBreadcrumbLink({
  href,
  connection,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
}) {
  const setStacGeoparquetId = useStore((store) => store.setStacGeoparquetId);
  const result = useStacGeoparquetValue({ href, connection });
  const title =
    (result.data?.title as string | undefined) ||
    href.split("/").pop() ||
    "Collection";

  return (
    <>
      <Breadcrumb.Item>
        <Breadcrumb.Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setStacGeoparquetId(null);
          }}
        >
          <HStack gap={1} whiteSpace="nowrap">
            {result.data && <StacIcon value={result.data} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </span>
          </HStack>
        </Breadcrumb.Link>
      </Breadcrumb.Item>
      <Breadcrumb.Separator />
    </>
  );
}

function getBreadcrumbLink(value: StacValue) {
  const selfLink = getLink(value, "self");
  const rootLink = getLink(value, "root");
  const parentLink = getLink(value, "parent");
  const collectionLink = getLink(value, "collection");

  return collectionLink && collectionLink.href !== selfLink?.href ? (
    <BreadcrumbLink link={collectionLink} />
  ) : parentLink &&
    parentLink.href !== rootLink?.href &&
    parentLink.href !== selfLink?.href ? (
    <BreadcrumbLink link={parentLink} />
  ) : (
    rootLink &&
    rootLink.href !== selfLink?.href && <BreadcrumbLink link={rootLink} root />
  );
}
