import React from 'react';
import { CheckCircle2, Clock3, AlertTriangle, AlertOctagon, Flame, CircleDotDashed, Send } from 'lucide-react';

export default function StatusBadge({ status }) {
  switch (status) {
    case 'Submitted':
      return (
        <span className="fd-status-submitted">
          <Send className="h-3 w-3" />
          Submitted
        </span>
      );
    case 'InProgress':
      return (
        <span className="fd-status-inprogress">
          <CircleDotDashed className="h-3 w-3" />
          In Progress
        </span>
      );
    case 'Done':
      return (
        <span className="fd-status-done">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      );
    case 'Delay':
      return (
        <span className="fd-status-delay">
          <AlertTriangle className="h-3 w-3" />
          Delay
        </span>
      );
    case 'Issue':
      return (
        <span className="fd-status-issue">
          <AlertOctagon className="h-3 w-3" />
          Issue
        </span>
      );
    case 'Pending':
    default:
      return (
        <span className="fd-status-pending">
          <Clock3 className="h-3 w-3" />
          Pending
        </span>
      );
  }
}

export function PriorityBadge({ priority }) {
  switch (priority) {
    case 'High':
      return (
        <span className="fd-priority-high">
          <Flame className="h-3 w-3" />
          High
        </span>
      );
    case 'Medium':
      return (
        <span className="fd-priority-medium">
          Medium
        </span>
      );
    case 'Low':
    default:
      return (
        <span className="fd-priority-low">
          Low
        </span>
      );
  }
}
