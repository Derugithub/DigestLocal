/** Web builds do not load Google Mobile Ads. */
export function AdBanner(_props: {
  placement: 'shelf_banner' | 'article_end_banner';
  size: string;
  width?: number;
}) {
  return null;
}
