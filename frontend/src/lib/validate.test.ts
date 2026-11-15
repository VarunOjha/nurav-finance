import { birthDateError, emailError } from './validate'

describe('form validators', () => {
  it('checks email shape', () => {
    expect(emailError('')).toMatch(/required/)
    expect(emailError('name@example')).toMatch(/valid email/)
    expect(emailError('name example.com')).toMatch(/valid email/)
    expect(emailError(' name@example.com ')).toBeNull()
  })

  it('keeps date of birth between 1900 and today', () => {
    expect(birthDateError('', '2026-10-13')).toBeNull()
    expect(birthDateError('1990-05-17', '2026-10-13')).toBeNull()
    expect(birthDateError('2026-10-14', '2026-10-13')).toMatch(/future/)
    expect(birthDateError('1899-12-31', '2026-10-13')).toMatch(/1900/)
  })
})
