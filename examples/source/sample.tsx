import { useTranslations } from 'next-intl'

export function ExamplePanel(): JSX.Element {
  const t = useTranslations()
  return (
    <section aria-labelledby="welcome-title">
      <h1 id="welcome-title">{t('welcome_title', { name: 'Alex' })}</h1>
      <button type="button">{t('save_button')}</button>
      <p>{t('items_count', { count: 2 })}</p>
      <p>{t.rich('formatted_link', { strong: (chunks) => <strong>{chunks}</strong> })}</p>
    </section>
  )
}
