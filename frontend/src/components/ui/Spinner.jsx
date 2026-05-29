export default function Spinner({ size = 24, label = 'Carregando…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div
        className="rounded-full border-[3px] animate-spin"
        style={{
          width: size, height: size,
          borderColor: '#E2E8F0',
          borderTopColor: '#2B3A8F',
        }}
      />
      {label && <p className="text-sm text-slate-400">{label}</p>}
    </div>
  )
}
