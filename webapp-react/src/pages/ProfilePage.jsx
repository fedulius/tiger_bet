import React from 'react';

const STATS = [
  { value: '142', label: 'Прогнозов', className: '' },
  { value: '61%', label: 'Проходимость', className: 'accent' },
  { value: '+18%', label: 'Профит', className: 'green' },
];

const SETTINGS = [
  { label: 'Уведомления', value: 'Вкл' },
  { label: 'Язык', value: 'Русский' },
  { label: 'Тема', value: 'Тёмная' },
  { label: 'Букмекеры', value: '3 активны' },
  { label: 'Конфиденциальность', value: '' },
  { label: 'О приложении', value: 'v2.0' },
];

export function ProfilePage() {
  return (
    <>
      <div className="page-header">
        <div className="page-title">Профиль</div>
      </div>

      <div className="profile-top">
        <div className="profile-avatar">IMG</div>
        <div>
          <div className="profile-name">Иван</div>
          <div className="profile-handle">@ivan_bet</div>
        </div>
      </div>

      <div className="stats-row">
        {STATS.map((stat, i) => (
          <div className="stat-cell" key={i}>
            <div className={`stat-value ${stat.className}`}>{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="settings-group">
        {SETTINGS.map((setting, i) => (
          <div className="setting-row" key={i}>
            <span className="setting-label">{setting.label}</span>
            <span className="setting-value">{setting.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}
