import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const SITE_URL = "https://dungle-scrubs.github.io/bones";
const SITE_TITLE = "Bones";
const SITE_DESCRIPTION =
	"Competitive multi-agent code review game — LLM agents hunt for bugs, security issues, doc drift, and more in your codebase.";

export default defineConfig({
	site: SITE_URL,
	integrations: [
		starlight({
			title: SITE_TITLE,
			description: SITE_DESCRIPTION,
			logo: {
				src: "./src/assets/logo.jpg",
				replacesTitle: false,
			},
			favicon: "/favicon.png",
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/dungle-scrubs/bones",
				},
			],
			head: [
				// OG Meta
				{
					tag: "meta",
					attrs: { property: "og:image", content: `${SITE_URL}/images/og-image.png` },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:width", content: "1200" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:height", content: "630" },
				},
				{
					tag: "meta",
					attrs: { property: "og:type", content: "website" },
				},
				// Twitter Card
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
				},
				{
					tag: "meta",
					attrs: { name: "twitter:image", content: `${SITE_URL}/images/og-image.png` },
				},
				// Apple Touch Icon
				{
					tag: "link",
					attrs: {
						rel: "apple-touch-icon",
						href: "/images/apple-touch-icon.png",
						sizes: "180x180",
					},
				},
			],
			sidebar: [
				{
					label: "Start Here",
					items: [
						{ slug: "getting-started" },
						{ slug: "guides/authentication" },
					],
				},
				{
					label: "Guides",
					items: [
						{ slug: "guides/playing-a-game" },
						{ slug: "guides/categories" },
						{ slug: "guides/dashboard" },
					],
				},
				{
					label: "Reference",
					autogenerate: { directory: "reference" },
				},
			],
			customCss: ["./src/styles/custom.css"],
			editLink: {
				baseUrl: "https://github.com/dungle-scrubs/bones/edit/main/apps/docs/",
			},
			lastUpdated: true,
		}),
	],
});
