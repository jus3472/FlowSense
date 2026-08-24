import { METRIC_LABEL, describeMetric } from '@/lib/results/summary'
import type { DeliveryMetricName, DeliveryStatistics, MetricResult } from '@/lib/scoring/mechanical'
import type { Pause } from '@/lib/scoring/pauses'

const ORDER: DeliveryMetricName[] = [
  'fillers',
  'mid_sentence_pauses',
  'energy',
  'pace',
  'time_to_first_word',
]

interface DeliverySectionProps {
  metrics: Record<DeliveryMetricName, MetricResult>
  statistics: DeliveryStatistics
  /** Each pause itself, so a row can name the ones that actually cost points. */
  pauses: readonly Pause[]
  earned: number
  max: number
}

/** Measurements only. No weights, no percentages, no component values. */
export function DeliverySection({
  metrics,
  statistics,
  pauses,
  earned,
  max,
}: DeliverySectionProps) {
  return (
    <section className="bg-surface rounded-card flex flex-col gap-6 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="prompt-display text-foreground text-xl">How you sounded</h2>
        <p className="numeric text-muted text-sm">
          {earned} / {max}
        </p>
      </div>

      <ul className="flex flex-col">
        {ORDER.map((name, index) => {
          const metric = metrics[name]
          return (
            <li
              key={name}
              className={`flex items-start justify-between gap-4 py-4 ${
                index === 0 ? 'pt-0' : 'border-border border-t'
              } ${index === ORDER.length - 1 ? 'pb-0' : ''}`}
            >
              <span className="flex flex-col gap-1">
                <span className="text-foreground text-sm font-medium">{METRIC_LABEL[name]}</span>
                <span className="text-muted text-xs">
                  {describeMetric(name, metric, statistics, pauses)}
                </span>
              </span>
              <span className="numeric text-foreground shrink-0 text-sm">
                {metric.points} / {metric.max_points}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
