import indexHtml from '../../index.html?raw'
import { resolveTheme, setTheme, STORAGE_KEY, THEMES } from './theme'

describe('themes', () => {
  it('resolves System to Paper or Ink by the OS setting', () => {
    expect(resolveTheme('system', false).id).toBe('paper')
    expect(resolveTheme('system', true).id).toBe('ink')
    expect(resolveTheme('dusk', false)).toMatchObject({ id: 'dusk', mode: 'dark' })
  })

  it('applies a choice to <html> and remembers it', () => {
    setTheme('linen')
    expect(document.documentElement.dataset).toMatchObject({ theme: 'linen', mode: 'light' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('linen')
    setTheme('dusk')
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dusk', mode: 'dark' })
  })

  it('keeps index.html in sync with the theme list', () => {
    for (const t of THEMES) expect(indexHtml).toContain(`${t.id}: '${t.mode}'`)
  })
})
