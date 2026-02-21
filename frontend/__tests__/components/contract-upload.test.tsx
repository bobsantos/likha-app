/**
 * Tests for ContractUpload component
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ContractUpload, { validateFile } from '@/components/contract-upload'

describe('ContractUpload component', () => {
  describe('validateFile', () => {
    it('returns null for a valid PDF under 10MB', () => {
      const file = new File(['content'], 'contract.pdf', { type: 'application/pdf' })
      expect(validateFile(file)).toBeNull()
    })

    it('returns an error for non-PDF files', () => {
      const file = new File(['content'], 'document.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      expect(validateFile(file)).toMatch(/pdf/i)
    })

    it('returns an error for text files', () => {
      const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
      expect(validateFile(file)).toMatch(/pdf/i)
    })

    it('returns an error when file exceeds 10MB', () => {
      // Create a mock file with a size property larger than 10MB
      const bigFile = Object.defineProperty(
        new File(['x'], 'big.pdf', { type: 'application/pdf' }),
        'size',
        { value: 11 * 1024 * 1024 }
      )
      expect(validateFile(bigFile)).toMatch(/10MB/i)
    })

    it('accepts a PDF exactly at 10MB boundary', () => {
      const file = Object.defineProperty(
        new File(['x'], 'edge.pdf', { type: 'application/pdf' }),
        'size',
        { value: 10 * 1024 * 1024 }
      )
      expect(validateFile(file)).toBeNull()
    })
  })

  describe('rendering', () => {
    it('renders the default dropzone prompt', () => {
      render(<ContractUpload onUpload={jest.fn()} />)
      expect(screen.getByText(/drop your pdf here or click to browse/i)).toBeInTheDocument()
      expect(screen.getByText(/PDF files only, max 10MB/i)).toBeInTheDocument()
    })

    it('renders a file input that accepts only PDFs', () => {
      render(<ContractUpload onUpload={jest.fn()} />)
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.accept).toBe('.pdf')
    })
  })

  describe('file selection via input', () => {
    it('displays the file name after a valid PDF is selected', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const file = new File(['pdf content'], 'my-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('my-contract.pdf')).toBeInTheDocument()
      })
    })

    it('displays the file size after a valid PDF is selected', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const file = new File(['pdf content'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        // Size is displayed in MB with 2 decimal places
        expect(screen.getByText(/\d+\.\d+ MB/)).toBeInTheDocument()
      })
    })

    it('shows Upload & Extract button after valid file is selected', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const file = new File(['pdf content'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload.*extract/i })).toBeInTheDocument()
      })
    })

    it('shows a validation error for non-PDF files', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const file = new File(['text'], 'document.txt', { type: 'text/plain' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText(/please upload a pdf file/i)).toBeInTheDocument()
      })
    })

    it('shows a validation error for oversized files', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const bigFile = Object.defineProperty(
        new File(['x'], 'huge.pdf', { type: 'application/pdf' }),
        'size',
        { value: 11 * 1024 * 1024 }
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [bigFile] } })

      await waitFor(() => {
        expect(screen.getByText(/10MB/i)).toBeInTheDocument()
      })
    })

    it('does not show the file name when a validation error occurs', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const file = new File(['text'], 'notes.txt', { type: 'text/plain' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
      })
    })
  })

  describe('upload callback', () => {
    it('calls onUpload with the selected file when the button is clicked', async () => {
      const onUpload = jest.fn()
      render(<ContractUpload onUpload={onUpload} />)

      const file = new File(['pdf'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload.*extract/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /upload.*extract/i }))

      expect(onUpload).toHaveBeenCalledTimes(1)
      expect(onUpload).toHaveBeenCalledWith(file)
    })

    it('does not call onUpload before a file is selected', () => {
      const onUpload = jest.fn()
      render(<ContractUpload onUpload={onUpload} />)
      // No button visible in default state — cannot click; just confirm no call
      expect(onUpload).not.toHaveBeenCalled()
    })

    it('disables the upload button when disabled prop is true', async () => {
      const onUpload = jest.fn()
      render(<ContractUpload onUpload={onUpload} disabled={true} />)

      const file = new File(['pdf'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /upload.*extract/i })
        expect(btn).toBeDisabled()
      })
    })
  })

  describe('drag and drop', () => {
    it('accepts a dropped PDF file', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const dropzone = screen.getByTestId('contract-upload')
      const file = new File(['pdf'], 'dropped.pdf', { type: 'application/pdf' })

      fireEvent.dragEnter(dropzone, {
        dataTransfer: { files: [file] },
      })
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      })

      await waitFor(() => {
        expect(screen.getByText('dropped.pdf')).toBeInTheDocument()
      })
    })

    it('shows validation error for non-PDF dropped file', async () => {
      render(<ContractUpload onUpload={jest.fn()} />)

      const dropzone = screen.getByTestId('contract-upload')
      const file = new File(['text'], 'notes.txt', { type: 'text/plain' })

      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      })

      await waitFor(() => {
        expect(screen.getByText(/please upload a pdf file/i)).toBeInTheDocument()
      })
    })
  })
})
