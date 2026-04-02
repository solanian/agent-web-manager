export type ApprovalResponseDecision = string;

export type TokenUsage = Record<string, number> & {
	input_other: number;
	input_cache_read: number;
	input_cache_creation: number;
	output: number;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
};

export type QuestionItem = {
	[key: string]: unknown;
	id: string;
	header?: string;
	body?: string;
	question?: string;
	label?: string;
	type?: string;
	placeholder?: string;
	options?: Array<{
		label: string;
		description?: string;
		value?: string;
	}>;
	multi_select?: boolean;
	other_label?: string;
	other_description?: string;
};
