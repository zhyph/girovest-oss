import { useAuthenticatedImageUrl } from '../../lib/useAuthenticatedImageUrl.ts'

interface AuthenticatedPhotoProps {
  url: string
  alt: string
  className: string
}

// `/api/products/:id/photos/:filename` requires a Bearer token a plain
// `<img src>` can't attach — those paths must go through useAuthenticatedImageUrl
// (fetch -> blob -> object URL). Staff-pasted external URLs don't need this.
export function AuthenticatedPhoto({ url, alt, className }: AuthenticatedPhotoProps) {
  const isRemotePath = url.startsWith('/api/')
  const authenticatedUrl = useAuthenticatedImageUrl(isRemotePath ? url : null)
  if (isRemotePath && !authenticatedUrl) {
    return <div className={className + ' bg-gray-100'} />
  }
  return <img src={isRemotePath ? authenticatedUrl! : url} alt={alt} className={className} />
}
