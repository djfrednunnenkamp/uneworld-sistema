import clsx from 'clsx'

const config = {
  active:     { label: 'Ativo',            dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inactive:   { label: 'Inativo',          dot: 'bg-slate-400',   cls: 'bg-slate-100  text-slate-500   border-slate-200'   },
  scheduled:  { label: 'Agendada',         dot: 'bg-blue-500',    cls: 'bg-blue-50    text-blue-700    border-blue-200'    },
  completed:  { label: 'Concluída',        dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled:  { label: 'Cancelada',        dot: 'bg-red-500',     cls: 'bg-red-50     text-red-700     border-red-200'     },
  pending:    { label: 'Pendente',         dot: 'bg-amber-500',   cls: 'bg-amber-50   text-amber-700   border-amber-200'   },
  confirmed:  { label: 'Confirmado',       dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  open:       { label: 'Aberta',           dot: 'bg-blue-500',    cls: 'bg-blue-50    text-blue-700    border-blue-200'    },
  full:       { label: 'Lotada',           dot: 'bg-orange-500',  cls: 'bg-orange-50  text-orange-700  border-orange-200'  },
  planning:   { label: 'Planejamento',     dot: 'bg-violet-500',  cls: 'bg-violet-50  text-violet-700  border-violet-200'  },
  ongoing:    { label: 'Em andamento',     dot: 'bg-teal-500',    cls: 'bg-teal-50    text-teal-700    border-teal-200'    },
  no_show:    { label: 'Não compareceu',   dot: 'bg-slate-400',   cls: 'bg-slate-100  text-slate-500   border-slate-200'   },
}

export default function Badge({ status, label }) {
  const c = config[status] ?? { label: status, dot: 'bg-slate-400', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border', c.cls)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', c.dot)} />
      {label ?? c.label}
    </span>
  )
}
