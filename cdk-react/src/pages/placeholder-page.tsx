type PlaceholderPageProps = {
  title: string
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <section className="min-h-[70vh] p-2">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
    </section>
  )
}
