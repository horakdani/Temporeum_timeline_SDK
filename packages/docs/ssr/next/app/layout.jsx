export const metadata = { title: "Idővonal — Next smoke" };

export default function RootLayout({ children }) {
  return (
    <html lang="hu">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
