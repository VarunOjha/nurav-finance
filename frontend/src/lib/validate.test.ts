import { birthDateError, emailError, phoneError } from './validate'

describe('form validators', () => {
  it('checks email shape', () => {
    expect(emailError('')).toMatch(/required/)
    expect(emailError('name@example')).toMatch(/valid email/)
    expect(emailError('name example.com')).toMatch(/valid email/)
    expect(emailError(' name@example.com ')).toBeNull()
  })

  it('accepts common phone formats and rejects junk', () => {
    expect(phoneError('')).toBeNull()
    for (const ok of ['+1 (415) 555-0123', '+91 98765 43210', '0201234567', '415.555.0123']) expect(phoneError(ok)).toBeNull()
    for (const bad of ['12-34', 'call me', '+1 234 567 890 123 456', '++14155550123', '415555012a']) expect(phoneError(bad)).not.toBeNull()
  })

  it('keeps date of birth between 1900 and today', () => {
    expect(birthDateError('', '2026-10-13')).toBeNull()
    expect(birthDateError('1990-05-17', '2026-10-13')).toBeNull()
    expect(birthDateError('2026-10-14', '2026-10-13')).toMatch(/future/)
    expect(birthDateError('1899-12-31', '2026-10-13')).toMatch(/1900/)
  })
})
