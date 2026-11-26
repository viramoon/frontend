import { DataState } from '../../components/TerminalStates';

export function Blog() {
  return (
    <section className="simple-page">
      <h1>博客</h1>
      <DataState
        kind="empty"
        title="暂无文章"
        detail="文章列表由后续博客 issue 接入，待排期。"
        illustrated
      />
    </section>
  );
}
