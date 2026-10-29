import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PRICED_KINDS, type PricedKind } from '@shared/pricing'
import { PROFILE_KIND_LABELS } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSupervision } from '@/stores/supervision'

/** Per-model list prices used to estimate API agents' cost. Claude Code reports its own cost. */
export function PricesSection() {
  const prices = useSupervision((s) => s.prices)
  const loadPrices = useSupervision((s) => s.loadPrices)
  const savePrice = useSupervision((s) => s.savePrice)
  const deletePrice = useSupervision((s) => s.deletePrice)
  const [kind, setKind] = useState<PricedKind>('openai')
  const [prefix, setPrefix] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  useEffect(() => {
    void loadPrices()
  }, [loadPrices])

  const valid = prefix.trim() && input !== '' && output !== '' && Number(input) >= 0 && Number(output) >= 0
  const numberField = 'h-7 w-20 text-right text-xs tabular-nums'

  return (
    <section className="mt-8 rounded-xl border bg-card px-5 py-4" aria-label="Prices">
      <h2 className="text-sm font-medium">Prices</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        USD per million tokens, to estimate what API agents cost. A model uses the longest prefix that matches its id.
        Anthropic, OpenAI and Gemini list prices were filled in from the providers’ pages in October 2026; check them
        (Google announced increases for some Gemini models), and add the models you use.
      </p>
      <table className="mt-3 w-full text-xs">
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 font-medium">Provider</th>
            <th className="py-1.5 font-medium">Model id starts with</th>
            <th className="py-1.5 text-right font-medium">Input</th>
            <th className="py-1.5 text-right font-medium">Output</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="py-1">{PROFILE_KIND_LABELS[p.kind]}</td>
              <td className="py-1 font-mono">
                {p.modelPrefix}
                {p.source === 'user' && <span className="ml-1.5 rounded bg-muted px-1 font-sans text-[10px] text-muted-foreground">yours</span>}
              </td>
              <td className="py-1 text-right">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={`Input price for ${p.modelPrefix}`}
                  defaultValue={p.inputPerMTok}
                  className={`${numberField} ml-auto`}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (e.target.value !== '' && v !== p.inputPerMTok) void savePrice({ ...p, inputPerMTok: v })
                  }}
                />
              </td>
              <td className="py-1 text-right">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={`Output price for ${p.modelPrefix}`}
                  defaultValue={p.outputPerMTok}
                  className={`${numberField} ml-auto`}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (e.target.value !== '' && v !== p.outputPerMTok) void savePrice({ ...p, outputPerMTok: v })
                  }}
                />
              </td>
              <td className="py-1 text-right">
                <Button size="icon-xs" variant="ghost" aria-label={`Delete the price of ${p.modelPrefix}`} onClick={() => void deletePrice(p.id)}>
                  <Trash2 />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          void savePrice({ kind, modelPrefix: prefix.trim(), inputPerMTok: Number(input), outputPerMTok: Number(output) }).then((ok) => {
            if (!ok) return
            setPrefix('')
            setInput('')
            setOutput('')
          })
        }}
      >
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PricedKind)}
          aria-label="Provider"
          className="h-7 rounded-md border bg-transparent px-2 text-xs"
        >
          {PRICED_KINDS.map((k) => (
            <option key={k} value={k}>
              {PROFILE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="gpt-5" aria-label="Model id prefix" className="h-7 w-40 font-mono text-xs" />
        <Input value={input} onChange={(e) => setInput(e.target.value)} type="number" min={0} step="0.01" placeholder="Input" aria-label="Input price" className={numberField} />
        <Input value={output} onChange={(e) => setOutput(e.target.value)} type="number" min={0} step="0.01" placeholder="Output" aria-label="Output price" className={numberField} />
        <Button type="submit" size="xs" disabled={!valid}>
          <Plus /> Add price
        </Button>
      </form>
    </section>
  )
}
