import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
	title: "Code Hunt Dashboard",
	description: "Real-time race visualization for Code Hunt",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className="dark">
			<body className="min-h-screen antialiased">
				<Providers>
					<Sidebar />
					{children}
				</Providers>
			</body>
		</html>
	);
}
