/**
 * ContractForm component - Multi-field extraction review form.
 *
 * Displays all editable contract terms extracted from a PDF.
 * Used in the upload page review step and can be reused elsewhere.
 *
 * Fields:
 * - Licensee name (text, required)
 * - Licensor name (text, optional)
 * - Contract start/end dates (date pickers, required)
 * - Royalty rate (RoyaltyRateInput — flat / tiered / category)
 * - Royalty base (dropdown: net sales / gross sales)
 * - Territories (comma-separated text)
 * - Reporting frequency (dropdown)
 * - Minimum guarantee (number, optional)
 * - Advance payment (number, optional)
 */

'use client'

import { AlertCircle } from 'lucide-react'
import RoyaltyRateInput from '@/components/RoyaltyRateInput'

export interface ContractFormData {
  licensee_name: string
  licensor_name: string
  licensee_email: string
  contract_start_date: string
  contract_end_date: string
  royalty_rate: string
  royalty_base: string
  territories: string
  reporting_frequency: string
  minimum_guarantee: string
  advance_payment: string
}

export interface ContractFormProps {
  /** Current form values. */
  data: ContractFormData
  /** Called when any field changes. */
  onChange: (field: keyof ContractFormData, value: string) => void
  /** Called when the form is submitted. */
  onSubmit: (e: React.FormEvent) => void
  /** Called when the cancel button is clicked. */
  onCancel: () => void
  /** Inline error message shown above the form. */
  error?: string | null
  /** Title of the inline error, shown in bold. */
  errorTitle?: string | null
  /** When true, the submit button shows a loading state. */
  submitting?: boolean
}

export default function ContractForm({
  data,
  onChange,
  onSubmit,
  onCancel,
  error,
  errorTitle,
  submitting = false,
}: ContractFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="contract-form">
      {/* Inline error banner */}
      {error && (
        <div
          className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg animate-slide-up"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            {errorTitle && (
              <p className="text-sm font-medium text-red-800">{errorTitle}</p>
            )}
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Licensee Name */}
        <div>
          <label htmlFor="licensee_name" className="block text-sm font-medium text-gray-700 mb-2">
            Licensee Name <span className="text-red-500">*</span>
          </label>
          <input
            id="licensee_name"
            type="text"
            value={data.licensee_name}
            onChange={(e) => onChange('licensee_name', e.target.value)}
            required
            className="input"
            data-testid="licensee-name-input"
          />
        </div>

        {/* Licensor Name */}
        <div>
          <label htmlFor="licensor_name" className="block text-sm font-medium text-gray-700 mb-2">
            Licensor Name
          </label>
          <input
            id="licensor_name"
            type="text"
            value={data.licensor_name}
            onChange={(e) => onChange('licensor_name', e.target.value)}
            className="input"
            data-testid="licensor-name-input"
          />
        </div>

        {/* Licensee Email */}
        <div>
          <label htmlFor="licensee_email" className="block text-sm font-medium text-gray-700 mb-2">
            Licensee Email
          </label>
          <input
            id="licensee_email"
            type="email"
            value={data.licensee_email}
            onChange={(e) => onChange('licensee_email', e.target.value)}
            placeholder="licensee@company.com"
            className="input"
            data-testid="licensee-email-input"
          />
          <p className="mt-1.5 text-xs text-gray-500">Used to auto-match inbound email reports</p>
        </div>

        {/* Contract Start Date */}
        <div>
          <label
            htmlFor="contract_start_date"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Contract Start Date <span className="text-red-500">*</span>
          </label>
          <input
            id="contract_start_date"
            type="date"
            value={data.contract_start_date}
            onChange={(e) => onChange('contract_start_date', e.target.value)}
            className="input"
            data-testid="contract-start-date-input"
          />
        </div>

        {/* Contract End Date */}
        <div>
          <label
            htmlFor="contract_end_date"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Contract End Date <span className="text-red-500">*</span>
          </label>
          <input
            id="contract_end_date"
            type="date"
            value={data.contract_end_date}
            onChange={(e) => onChange('contract_end_date', e.target.value)}
            className="input"
            data-testid="contract-end-date-input"
          />
        </div>

        {/* Royalty Rate */}
        <div>
          <label htmlFor="royalty_rate" className="block text-sm font-medium text-gray-700 mb-2">
            Royalty Rate <span className="text-red-500">*</span>
          </label>
          <RoyaltyRateInput
            id="royalty_rate"
            value={data.royalty_rate}
            onChange={(value) => onChange('royalty_rate', value)}
            required
          />
        </div>

        {/* Royalty Base */}
        <div>
          <label htmlFor="royalty_base" className="block text-sm font-medium text-gray-700 mb-2">
            Royalty Base <span className="text-red-500">*</span>
          </label>
          <select
            id="royalty_base"
            value={data.royalty_base}
            onChange={(e) => onChange('royalty_base', e.target.value)}
            required
            className="input"
            data-testid="royalty-base-select"
          >
            <option value="net_sales">Net Sales</option>
            <option value="gross_sales">Gross Sales</option>
          </select>
        </div>

        {/* Reporting Frequency */}
        <div>
          <label
            htmlFor="reporting_frequency"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Reporting Frequency <span className="text-red-500">*</span>
          </label>
          <select
            id="reporting_frequency"
            value={data.reporting_frequency}
            onChange={(e) => onChange('reporting_frequency', e.target.value)}
            required
            className="input"
            data-testid="reporting-frequency-select"
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi_annually">Semi-Annually</option>
            <option value="annually">Annually</option>
          </select>
        </div>

        {/* Territories */}
        <div>
          <label htmlFor="territories" className="block text-sm font-medium text-gray-700 mb-2">
            Territories
          </label>
          <input
            id="territories"
            type="text"
            value={data.territories}
            onChange={(e) => onChange('territories', e.target.value)}
            placeholder="e.g., USA, Canada, UK"
            className="input"
            data-testid="territories-input"
          />
          <p className="mt-1.5 text-xs text-gray-500">Separate multiple territories with commas.</p>
        </div>

        {/* Minimum Guarantee */}
        <div>
          <label
            htmlFor="minimum_guarantee"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Minimum Guarantee ($)
          </label>
          <input
            id="minimum_guarantee"
            type="number"
            value={data.minimum_guarantee}
            onChange={(e) => onChange('minimum_guarantee', e.target.value)}
            placeholder="0"
            min="0"
            step="0.01"
            className="input"
            data-testid="minimum-guarantee-input"
          />
        </div>

        {/* Advance Payment */}
        <div>
          <label
            htmlFor="advance_payment"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Advance Payment ($)
          </label>
          <input
            id="advance_payment"
            type="number"
            value={data.advance_payment}
            onChange={(e) => onChange('advance_payment', e.target.value)}
            placeholder="0"
            min="0"
            step="0.01"
            className="input"
            data-testid="advance-payment-input"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-4 justify-end pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
          data-testid="cancel-button"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="submit-button"
        >
          {submitting ? 'Saving...' : 'Confirm and Save'}
        </button>
      </div>
    </form>
  )
}
