
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import safeArea from "tailwindcss-safe-area";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				sans: ['Anonymous Pro', 'Inter', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
				mono: ['Anonymous Pro', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
			},
			// Font-size scale upscaled ×16/14 (Anonymous Pro renders small; text-sm 0.875rem → 1rem).
			// Applied app-wide via standard Tailwind utilities; spacing/layout (rem-based) is left untouched.
			fontSize: {
				xs: ['0.875rem', { lineHeight: '1.125rem' }],
				sm: ['1rem', { lineHeight: '1.4375rem' }],
				base: ['1.125rem', { lineHeight: '1.75rem' }],
				lg: ['1.25rem', { lineHeight: '2rem' }],
				xl: ['1.4375rem', { lineHeight: '2rem' }],
				'2xl': ['1.75rem', { lineHeight: '2.25rem' }],
				'3xl': ['2.125rem', { lineHeight: '2.5625rem' }],
				'4xl': ['2.5625rem', { lineHeight: '2.875rem' }],
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: '#053B29',
					foreground: 'hsl(var(--primary-foreground))'
				},
				// ── New "Agrivate 2.0" design tokens ──────────────────────────
				// Brand deep-forest green — headings, primary text, dark icons
				brand: {
					DEFAULT: '#053B29',
					light: '#0B5D40',
					deep: '#042E21',
				},
				// Neutral surfaces
				surface: {
					app: '#F8FAF9',        // App main background
					card: '#FFFFFF',       // Card background
					sub: '#F0F5F3',        // Sub-card fill (badges, icon circles, metric boxes)
					line: '#E6EDEA',       // Subtle border (emerald-tinted slate)
				},
				// Soft pastel alert / status colors
				status: {
					danger: { bg: '#FDE8E8', text: '#E53E3E' },   // Critical heat
					warning: { bg: '#FEF3C7', text: '#D97706' },  // Disease risk
					info: { bg: '#E0F2FE', text: '#0284C7' },     // Moisture alert
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				// Accent active emerald — toggles, live indicators, graph lines
				accent: {
					DEFAULT: '#10B981',
					active: '#00A86B',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},
				// Custom agriculture colors (legacy — kept for compatibility)
				agri: {
					green: '#10B981',
					dark: '#053B29'
				}
			},
			borderRadius: {
				'2xl': '1rem',
				'3xl': '1.5rem',
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'fade-in': {
					'0%': {
						opacity: '0',
						transform: 'translateY(10px)'
					},
					'100%': {
						opacity: '1',
						transform: 'translateY(0)'
					}
				},
				'scale-in': {
					'0%': {
						transform: 'scale(0.95)',
						opacity: '0'
					},
					'100%': {
						transform: 'scale(1)',
						opacity: '1'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'fade-in': 'fade-in 0.3s ease-out',
				'scale-in': 'scale-in 0.2s ease-out'
			},
			boxShadow: {
				'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
			}
		}
	},
	plugins: [animate, safeArea],
} satisfies Config;
