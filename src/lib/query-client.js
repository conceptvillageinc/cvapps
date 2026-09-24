import { QueryClient } from '@tanstack/react-query';

// 画面を行き来するたびに読み直して「毎回リロード」に見えていたため、
// 一度読んだデータは 5 分間はそのまま使う（保存後は各画面が invalidate する）。
// 5 分を過ぎても、画面には手元のデータを先に出してから裏で読み直すので待たされない。
// 長くしすぎると、他のメンバーが直した内容が自分の画面に出るまでが遅くなる。
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
			retry: 1,
		},
	},
});
