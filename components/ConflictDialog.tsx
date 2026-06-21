'use client'

interface Props {
  conflictTitle: string
  conflictTime: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConflictDialog({ conflictTitle, conflictTime, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900">Time conflict</h3>
        <p className="text-sm text-gray-600">
          This slot overlaps with <span className="font-medium text-gray-900">{conflictTitle}</span> at {conflictTime}.
          Place here anyway?
        </p>
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Overlap anyway
          </button>
        </div>
      </div>
    </div>
  )
}
