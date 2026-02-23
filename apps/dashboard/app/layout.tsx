import type { Metadata } from "next";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "./providers";
import "./globals.css";

const body = DM_Sans({
	subsets: ["latin"],
	variable: "--font-dm-sans",
	display: "swap",
});

const display = Fraunces({
	subsets: ["latin"],
	variable: "--font-fraunces",
	display: "swap",
});

const mono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-jetbrains-mono",
	display: "swap",
});

export const metadata: Metadata = {
	title: "Bones",
	description: "Competitive multi-agent code review",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
			className={`${body.variable} ${display.variable} ${mono.variable}`}
		>
			<body className="min-h-screen antialiased">
				<Providers>
					<Sidebar />
					{children}
				</Providers>
			</body>
		</html>
	);
}
