import { useAuthenticatedImageUrl } from '../../lib/useAuthenticatedImageUrl.ts'

interface AuthenticatedPhotoProps {
  url: string
  alt: string
  className: string
}

// `/api/products/:id/photos/:filename` requires a Bearer token a plain
// `<img src>` can't attach — those paths must go through useAuthenticatedImageUrl
// (fetch -> blob -> object URL). Every product photo is one of these paths
// now that the picker replaced the old URL text field; the `isRemotePath`
// branch below only still matters for a `data:` URL held locally in
// ProductDrawer before it's been uploaded.
export function AuthenticatedPhoto({ url, alt, className }: AuthenticatedPhotoProps) {
  const isRemotePath = url.startsWith('/api/')
  const authenticatedUrl = useAuthenticatedImageUrl(isRemotePath ? url : null)
  if (isRemotePath && !authenticatedUrl) {
    return <div className={className + ' bg-muted'} />
  }
  return <img src={isRemotePath ? authenticatedUrl! : url} alt={alt} className={className} />
}
