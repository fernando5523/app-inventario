import { HiChevronLeft, HiChevronRight } from 'react-icons/hi'

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems?: number
  itemsPerPage?: number
  onPageChange: (page: number) => void
  isLoading?: boolean
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems = 0,
  itemsPerPage = 20,
  onPageChange,
  isLoading = false,
}: PaginationProps) {
  const pages = []
  const maxVisible = 5

  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2))
  let endPage = Math.min(totalPages, startPage + maxVisible - 1)

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1)
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i)
  }

  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="flex flex-col gap-4 items-center justify-between py-4 px-4 border-t border-[var(--border)] sm:flex-row">
      <p className="text-sm text-[var(--fg-muted)]">
        Mostrando <span className="font-semibold">{startItem}</span> a <span className="font-semibold">{endItem}</span> de <span className="font-semibold">{totalItems}</span> resultados
      </p>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1 || isLoading}
          className="btn btn-default"
          title="Página anterior"
        >
          <HiChevronLeft className="w-4 h-4" />
          Anterior
        </button>

        <div className="flex items-center gap-0.5 px-2">
          {startPage > 1 && (
            <>
              <button
                onClick={() => onPageChange(1)}
                disabled={isLoading}
                className="px-2 py-1 text-sm text-[var(--fg)] hover:bg-[var(--bg-subtle)] rounded-md transition-colors disabled:opacity-50"
              >
                1
              </button>
              {startPage > 2 && <span className="text-[var(--border)] px-1">...</span>}
            </>
          )}

          {pages.map((page) => (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              disabled={isLoading}
              className={`px-2 py-1 text-sm rounded-md transition-colors disabled:opacity-50 ${
                page === currentPage
                  ? 'bg-[var(--primary)] text-white font-semibold'
                  : 'text-[var(--fg)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {page}
            </button>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && <span className="text-[var(--border)] px-1">...</span>}
              <button
                onClick={() => onPageChange(totalPages)}
                disabled={isLoading}
                className="px-2 py-1 text-sm text-[var(--fg)] hover:bg-[var(--bg-subtle)] rounded-md transition-colors disabled:opacity-50"
              >
                {totalPages}
              </button>
            </>
          )}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || isLoading}
          className="btn btn-default"
          title="Página siguiente"
        >
          Siguiente
          <HiChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
