import { NextStep } from '../../types/nextStep'

export const mockNextSteps: NextStep[] = [
  {
    id: 'step-001',
    task: 'UIデザインの完成',
    assignee: '佐藤花子',
    deadline: '2025-07-22',
    priority: 'high',
    status: 'pending'
  },
  {
    id: 'step-002',
    task: 'データベース設計書の作成',
    assignee: '鈴木一郎',
    deadline: '2025-07-20',
    priority: 'medium',
    status: 'in_progress'
  },
  {
    id: 'step-003',
    task: 'API仕様書の確認',
    assignee: '田中太郎',
    deadline: '2025-07-18',
    priority: 'high',
    status: 'completed'
  },
  {
    id: 'step-004',
    task: 'テストケースの作成',
    assignee: '山田次郎',
    deadline: '2025-07-25',
    priority: 'medium',
    status: 'pending'
  },
  {
    id: 'step-005',
    task: 'セキュリティレビュー',
    assignee: '高橋美咲',
    deadline: '2025-07-30',
    priority: 'low',
    status: 'pending'
  }
]

export const mockNextStep: NextStep = mockNextSteps[0]

// 期限切れタスクのモックデータ
export const overdueTasks: NextStep[] = [
  {
    id: 'overdue-001',
    task: '期限切れのタスク1',
    assignee: '田中太郎',
    deadline: '2025-07-10',
    priority: 'high',
    status: 'pending'
  },
  {
    id: 'overdue-002',
    task: '期限切れのタスク2',
    assignee: '佐藤花子',
    deadline: '2025-07-12',
    priority: 'medium',
    status: 'in_progress'
  }
]

// 優先度別のタスクフィルター用
export const tasksByPriority = {
  high: mockNextSteps.filter(step => step.priority === 'high'),
  medium: mockNextSteps.filter(step => step.priority === 'medium'),
  low: mockNextSteps.filter(step => step.priority === 'low')
}

// ステータス別のタスクフィルター用
export const tasksByStatus = {
  pending: mockNextSteps.filter(step => step.status === 'pending'),
  in_progress: mockNextSteps.filter(step => step.status === 'in_progress'),
  completed: mockNextSteps.filter(step => step.status === 'completed')
}