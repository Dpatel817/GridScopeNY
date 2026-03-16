interface Props {
  message?: string
}

export default function EmptyState({ message }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-icon">📭</div>
      <h3>No data available</h3>
      <p>{message || 'No processed data found for this dataset.'}</p>
    </div>
  )
}
