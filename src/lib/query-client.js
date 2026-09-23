import { QueryClient } from '@tanstack/react-query';

// 画面を行き来するたびに読み直して「毎回リロード」に見えていたため、
// 一度読んだデータは 2 分間はそのまま使う（保存後は各画面が invalidate する）。
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			staleTime: 2 * 60 * 1000,
			retry: 1,
		},
	},
});
