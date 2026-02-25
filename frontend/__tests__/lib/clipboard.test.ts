/**
 * Tests for the copyToClipboard utility.
 */

import { copyToClipboard } from '@/lib/clipboard'

describe('copyToClipboard', () => {
  let originalClipboard: Clipboard
  let originalExecCommand: typeof document.execCommand

  beforeEach(() => {
    originalClipboard = navigator.clipboard
    originalExecCommand = document.execCommand
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    })
    document.execCommand = originalExecCommand
  })

  describe('when navigator.clipboard is available', () => {
    it('calls navigator.clipboard.writeText with the provided text', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })

      await copyToClipboard('hello world')

      expect(writeText).toHaveBeenCalledWith('hello world')
    })

    it('returns true on success', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })

      const result = await copyToClipboard('test')

      expect(result).toBe(true)
    })

    it('falls back to execCommand when clipboard.writeText rejects', async () => {
      const writeText = jest.fn().mockRejectedValue(new Error('NotAllowedError'))
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })
      document.execCommand = jest.fn().mockReturnValue(true)

      const result = await copyToClipboard('fallback text')

      expect(document.execCommand).toHaveBeenCalledWith('copy')
      expect(result).toBe(true)
    })
  })

  describe('when navigator.clipboard is unavailable', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })
    })

    it('uses the execCommand fallback', async () => {
      document.execCommand = jest.fn().mockReturnValue(true)

      await copyToClipboard('fallback text')

      expect(document.execCommand).toHaveBeenCalledWith('copy')
    })

    it('returns true when execCommand succeeds', async () => {
      document.execCommand = jest.fn().mockReturnValue(true)

      const result = await copyToClipboard('fallback text')

      expect(result).toBe(true)
    })

    it('returns false when execCommand returns false', async () => {
      document.execCommand = jest.fn().mockReturnValue(false)

      const result = await copyToClipboard('fallback text')

      expect(result).toBe(false)
    })

    it('returns false when execCommand throws', async () => {
      document.execCommand = jest.fn().mockImplementation(() => {
        throw new Error('execCommand not supported')
      })

      const result = await copyToClipboard('fallback text')

      expect(result).toBe(false)
    })

    it('appends and removes a textarea from the DOM during copy', async () => {
      const appendChildSpy = jest.spyOn(document.body, 'appendChild')
      const removeChildSpy = jest.spyOn(document.body, 'removeChild')
      document.execCommand = jest.fn().mockReturnValue(true)

      await copyToClipboard('dom test')

      expect(appendChildSpy).toHaveBeenCalledTimes(1)
      const appendedEl = appendChildSpy.mock.calls[0][0] as HTMLTextAreaElement
      expect(appendedEl.tagName).toBe('TEXTAREA')
      expect(appendedEl.value).toBe('dom test')

      expect(removeChildSpy).toHaveBeenCalledTimes(1)

      appendChildSpy.mockRestore()
      removeChildSpy.mockRestore()
    })
  })

  describe('when both strategies fail', () => {
    it('returns false', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: jest.fn().mockRejectedValue(new Error('denied')),
        },
        writable: true,
        configurable: true,
      })
      document.execCommand = jest.fn().mockReturnValue(false)

      const result = await copyToClipboard('text')

      expect(result).toBe(false)
    })
  })
})
