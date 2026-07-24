import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getLocaleConfig, formatCurrency } from '../../lib/locale.ts'
import type { Product } from './productSchemas.ts'

export function ProductDetailModal({
  product,
  open,
  onClose,
}: {
  product: Product | null
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('products')
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency

  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-lg">
        <DialogTitle className="mb-3 text-base font-semibold text-ink">{product.name}</DialogTitle>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-text">{t('fields.category')}</dt>
            <dd>{product.category}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.size')}</dt>
            <dd>{product.size}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.color')}</dt>
            <dd>{product.color}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.rentalPrice')}</dt>
            <dd>{formatCurrency(product.rentalPrice, locale, currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.depositAmount')}</dt>
            <dd>{formatCurrency(product.depositAmount, locale, currency)}</dd>
          </div>
        </dl>
        {product.description && (
          <p className="mt-3 text-sm text-ink">{product.description}</p>
        )}
        {product.photos && product.photos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {product.photos.map((url) => (
              <img key={url} src={url} alt={product.name} className="h-24 w-24 rounded object-cover" />
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.close', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
