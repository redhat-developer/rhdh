/**
 * Demo Progress replacement: a full-width red bar so the NFS
 * `core-progress` swappable override is obvious in the UI.
 */
export function Progress() {
  return (
    <div
      data-testid="rhdh-demo-progress"
      role="progressbar"
      aria-label="Loading"
      style={{
        width: "100%",
        height: 24,
        backgroundColor: "#d32f2f",
      }}
    />
  );
}
