const variants = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-500',
  scheduled: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
  open: 'bg-blue-100 text-blue-700',
  full: 'bg-orange-100 text-orange-700',
  planning: 'bg-purple-100 text-purple-700',
  ongoing: 'bg-teal-100 text-teal-700',
  no_show: 'bg-slate-100 text-slate-500',
  confirmed: 'bg-emerald-100 text-emerald-700',
  default: 'bg-slate-100 text-slate-600',
}

export default function Badge({ status, label }) {
  const cls = variants[status] ?? variants.default
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label || status}
    </span>
  )
}
