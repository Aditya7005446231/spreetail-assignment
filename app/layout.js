import "./globals.css";

export const metadata = {
  title: "Spreetail Split - Shared Expenses App",
  description: "Relational database-backed shared expenses calculator with timeline memberships, cash settlement minimization, and CSV anomaly reviewing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
