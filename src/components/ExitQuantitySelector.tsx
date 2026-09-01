type Props = {
  options: number[];
  value: number;
  unit?: string;
  onChange: (val: number) => void;
};

export default function ExitQuantitySelector({ options, value, unit = "%", onChange }: Props) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="rounded bg-slate-800 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
      aria-label={unit === "%" ? "Select exit percentage" : `Select exit ${unit}`}
    >
      {options.map((p) => (
        <option key={p} value={p}>
          {p} {unit}
        </option>
      ))}
    </select>
  );
}
