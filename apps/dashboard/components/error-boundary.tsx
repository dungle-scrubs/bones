"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	handleReset = () => {
		this.setState({ hasError: false, error: null });
	};

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<div className="flex flex-col items-center justify-center p-8 space-y-4">
					<div className="flex items-center gap-2 text-invalid">
						<AlertCircle className="h-5 w-5" />
						<span className="font-display text-lg font-semibold uppercase tracking-wider">
							Something went wrong
						</span>
					</div>
					<p className="text-sm text-muted-foreground font-mono max-w-md text-center">
						{this.state.error?.message ?? "An unexpected error occurred"}
					</p>
					<Button variant="outline" size="sm" onClick={this.handleReset}>
						<RefreshCw className="h-3 w-3 mr-2" />
						Try again
					</Button>
				</div>
			);
		}

		return this.props.children;
	}
}
