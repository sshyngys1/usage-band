import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Tokens } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [] as Limit[])
const tokens = atom(
  { plugin: 'usage-band', key: 'tokens' } as const,
  { input: 0, output: 0, cached: 0 } as Tokens
)

const BAR = 16

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`

const untilReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) return `RESET ${days}D ${hours}H`
  if (hours > 0) return `RESET ${hours}H ${minutes % 60}M`

  return `RESET ${minutes}M`
}

// Above 80: red; above 70: yellow; otherwise green.
const tone = (percent: number): string => (percent > 80 ? 'red' : percent > 70 ? 'yellow' : 'green')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage

    // Main loop only: a subagent's turns have an agentId.
    if (u && !e.agentId) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens + u.cache_creation_input_tokens,
        output: t.output + u.output_tokens,
        cached: t.cached + u.cache_read_input_tokens
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const windows = await read($, limits)
    const spent = await read($, tokens)
    const now = await $.clock.now()
    const five = windows.find(w => w.kind === 'five_hour')
    const week = windows.find(w => w.kind === 'seven_day')

    const label = (text: string) => (
      <Text weight="bold" color="cyan" wrap="truncate-end">
        {text}
      </Text>
    )

    const meter = (w: Limit | undefined, name: string) => {
      const percent = w ? w.percentUsed : 0
      const color = tone(percent)
      const filled = Math.min(BAR, Math.round((percent / 100) * BAR))

      return (
        <Box key={name} gap={1} flexShrink={0}>
          {label(name)}
          <Box flexShrink={0}>
            <Text backgroundColor={w ? color : 'gray'} wrap="truncate-end">
              {' '.repeat(filled)}
            </Text>
            <Text backgroundColor="gray" dimColor wrap="truncate-end">
              {' '.repeat(BAR - filled)}
            </Text>
          </Box>
          <Text weight="bold" color={color} tabular wrap="truncate-end">
            {w ? `${Math.round(percent)}%` : '—'}
          </Text>
          <Text dimColor wrap="truncate-end">
            {w ? untilReset(w.resetsAt, now) : ''}
          </Text>
        </Box>
      )
    }

    return (
      <Box borderStyle="round" borderColor="gray" borderDimColor paddingX={1} gap={3} flexWrap="wrap">
        {meter(five, '5H')}
        {meter(week, 'WEEK')}
        <Box gap={1} flexShrink={0}>
          {label('TOKENS')}
          <Text weight="bold" color="green" wrap="truncate-end">
            ↑ {compact(spent.input)}
          </Text>
          <Text weight="bold" color="red" wrap="truncate-end">
            ↓ {compact(spent.output)}
          </Text>
          <Text dimColor wrap="truncate-end">
            CACHE {compact(spent.cached)}
          </Text>
        </Box>
      </Box>
    )
  })
}
