import React from 'react'

interface AlertProps {
  children: React.ReactNode
  variant?: 'default' | 'destructive'
  className?: string
}

export const Alert: React.FC<AlertProps> = ({ 
  children, 
  variant = 'default',
  className = '' 
}) => {
  const variantClasses = {
    default: 'bg-blue-50 border-blue-200 text-blue-800',
    destructive: 'bg-red-50 border-red-200 text-red-800'
  }

  return (
    <div className={`border p-4 rounded-lg ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  )
}

export const AlertTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <h3 className="font-semibold mb-1">{children}</h3>
}

export const AlertDescription: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className="text-sm">{children}</div>
}