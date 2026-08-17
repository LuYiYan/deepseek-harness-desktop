/**
 * Task workbench view: one conversation view tab ("任务") presenting the
 * session's goal, plan-mode state, and todo list as cards, plus a running
 * indicator. Pure projection surface — every value arrives through
 * `useProjection` / `useSession`; the board owns no store or refresh chain.
 */
import type { ReactElement } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: loads the goal/plan/todos SessionProjectionMap merges so the
// projection keys and value types resolve.
import type {} from '@deepseek-ai/dsh-goal/client'
import type {} from '@deepseek-ai/dsh-plan-mode/types'
import type {} from '@deepseek-ai/dsh-tool-todo/types'
import styles from './TaskBoardView.module.css'

/** Durable goal-phase label. */
const PHASE_LABEL: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  blocked: '受阻',
  complete: '已完成',
}

/** Todo lifecycle label. */
const TODO_LABEL: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
}

/** The task board body: goal, plan, and todos cards plus a running indicator. */
export function TaskBoardView({ useProjection, useSession }: ConvViewProps): ReactElement {
  const goal = useProjection('goal')
  const plan = useProjection('plan')
  const todos = useProjection('todos')
  const running = useSession(session => session.running)

  return (
    <div className={styles.board}>
      <div className={styles.header}>
        <span className={styles.title}>任务工作台</span>
        <span className={running ? styles.running : styles.idle}>{running ? '运行中' : '空闲'}</span>
      </div>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>目标</h3>
        {goal === null || goal === undefined ? (
          <p className={styles.empty}>暂无目标（可用 /goal 创建）</p>
        ) : (
          <div>
            <p className={styles.goalText}>{goal.goal.objective}</p>
            <div className={styles.meta}>
              <span className={styles.badge}>{PHASE_LABEL[goal.goal.phase] ?? goal.goal.phase}</span>
              <span>轮次 {goal.roundsStarted}/{goal.goal.maxGoalRounds}</span>
            </div>
            {goal.goal.phase === 'blocked' && goal.goal.blockedReason !== undefined ? (
              <p className={styles.blocked}>{goal.goal.blockedReason.message}</p>
            ) : null}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>计划模式</h3>
        {plan === undefined ? (
          <p className={styles.empty}>不可用</p>
        ) : (
          <div className={styles.meta}>
            <span className={plan.active ? styles.badgeActive : styles.badge}>
              {plan.active ? '已启用' : '未启用'}
            </span>
            {plan.pending ? <span className={styles.badge}>切换中</span> : null}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>待办</h3>
        {todos === null || todos === undefined || todos.length === 0 ? (
          <p className={styles.empty}>暂无待办</p>
        ) : (
          <ul className={styles.todoList}>
            {todos.map((todo, index) => (
              <li key={index} className={styles.todoRow}>
                <span className={styles.todoText}>{todo.content}</span>
                <span className={styles.badge}>{TODO_LABEL[todo.status] ?? todo.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
