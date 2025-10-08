from flask import Blueprint, jsonify, request
import requests
import os
# 이벤트 분석 패널 블루프린트
event_analytics_bp = Blueprint('event_analytics', __name__)
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')

@event_analytics_bp.route('/proxy/events/analytics')
def proxy_events_analytics():
    """이벤트 분석 데이터 백엔드 API 프록시 (CORS 우회용)"""
    start_date = request.args.get('start')
    end_date = request.args.get('end')
    severity = request.args.get('severity', 'all')

    if not start_date or not end_date:
        return jsonify({"error": "start and end parameters required"}), 400

    try:
        # 실제 백엔드 호출
        backend_url = f"{BACKEND_URL}/api/v1/events/analytics?start={start_date}&end={end_date}&severity={severity}"
        response = requests.get(backend_url, timeout=10)

        if response.status_code == 200:
            data = response.json()
            print(f"[EVENT_ANALYTICS] API 호출 성공: {data}")
            return jsonify(data)
        else:
            error_msg = f"Backend returned {response.status_code}"
            print(f"[EVENT_ANALYTICS] API 오류: {error_msg}")
            return jsonify({"error": error_msg}), response.status_code

    except requests.RequestException as e:
        error_msg = f"Backend connection failed: {str(e)}"
        print(f"[EVENT_ANALYTICS] 연결 오류: {error_msg}")
        return jsonify({"error": error_msg}), 500


class EventAnalyticsComponent:
    """이벤트 분석 차트 컴포넌트 클래스"""

    @staticmethod
    def format_type_pie_data(raw_data):
        """이벤트 타입별 파이차트 데이터 포맷"""
        if not raw_data or 'type_pie' not in raw_data:
            return []

        type_data = raw_data['type_pie']
        formatted_data = []

        for item in type_data:
            formatted_data.append({
                'label': item.get('label', 'Unknown'),
                'count': item.get('count', 0),
                'percentage': EventAnalyticsComponent._calculate_percentage(item.get('count', 0), type_data)
            })

        return formatted_data

    @staticmethod
    def format_hourly_bar_data(raw_data):
        """시간대별 바차트 데이터 포맷"""
        if not raw_data or 'hourly_bar' not in raw_data:
            return []

        hourly_data = raw_data['hourly_bar']

        # 24시간 완전한 데이터 보장
        complete_hours = []
        for hour in range(24):
            found_data = next((item for item in hourly_data if item.get('hour') == hour), None)
            complete_hours.append({
                'hour': hour,
                'count': found_data.get('count', 0) if found_data else 0,
                'label': f"{hour:02d}:00"
            })

        return complete_hours

    @staticmethod
    def _calculate_percentage(value, total_data):
        """전체 대비 퍼센트 계산"""
        total = sum(item.get('count', 0) for item in total_data)
        if total == 0:
            return 0
        return round((value / total) * 100, 1)

    @staticmethod
    def get_peak_hour(hourly_data):
        """피크 시간대 계산"""
        if not hourly_data:
            return None

        max_item = max(hourly_data, key=lambda x: x.get('count', 0))
        return {
            'hour': max_item.get('hour'),
            'count': max_item.get('count'),
            'label': f"{max_item.get('hour', 0):02d}:00"
        }

    @staticmethod
    def get_severity_distribution(analytics_data, severity_filter='all'):
        """중요도별 분포 통계"""
        if not analytics_data or 'type_pie' not in analytics_data:
            return {'critical': 0, 'warn': 0, 'info': 0}

        distribution = {'critical': 0, 'warn': 0, 'info': 0}

        for item in analytics_data['type_pie']:
            label = item.get('label', '').lower()
            count = item.get('count', 0)

            if 'critical' in label or 'danger' in label:
                distribution['critical'] += count
            elif 'warn' in label or 'warning' in label:
                distribution['warn'] += count
            elif 'info' in label or 'information' in label:
                distribution['info'] += count

        return distribution

    @staticmethod
    def calculate_hourly_average(hourly_data):
        """시간당 평균 이벤트 수 계산"""
        if not hourly_data:
            return 0

        total_events = sum(item.get('count', 0) for item in hourly_data)
        return round(total_events / 24, 2)

    @staticmethod
    def get_active_hours(hourly_data, threshold=1):
        """활성 시간대 (임계값 이상의 이벤트가 있는 시간) 계산"""
        if not hourly_data:
            return []

        active_hours = []
        for item in hourly_data:
            if item.get('count', 0) >= threshold:
                active_hours.append({
                    'hour': item.get('hour'),
                    'count': item.get('count'),
                    'label': f"{item.get('hour', 0):02d}:00"
                })

        return sorted(active_hours, key=lambda x: x['count'], reverse=True)


# 차트 색상 관련 유틸리티 함수들
class ChartColorUtils:
    """차트 색상 관련 유틸리티"""

    SEVERITY_COLORS = {
        'critical': ['#DD2E44', '#E74C3C', '#C0392B', '#A93226', '#922B21'],
        'warn': ['#F4900C', '#E67E22', '#D68910', '#B7950B', '#9A7D0A'],
        'info': ['#77B256', '#58D68D', '#52C41A', '#389E0D', '#237804'],
        'all': [
            '#FF6384', '#6EC6FF', '#FFCE56', '#4BC0C0',
            '#9966FF', '#FF9F40', '#8B4513', '#727171',
            '#228B22', '#00008B'
        ]
    }

    @staticmethod
    def get_colors_by_severity(severity, count=5):
        """중요도별 색상 배열 반환"""
        colors = ChartColorUtils.SEVERITY_COLORS.get(severity.lower(),
                                                     ChartColorUtils.SEVERITY_COLORS['all'])
        return colors[:count] if count <= len(colors) else colors

    @staticmethod
    def get_single_color(severity, alpha=1):
        """단일 색상 반환 (바차트용)"""
        color_map = {
            'critical': f'rgba(221, 46, 68, {alpha})',
            'warn': f'rgba(244, 144, 12, {alpha})',
            'info': f'rgba(119, 178, 86, {alpha})',
            'all': f'rgba(102, 198, 255, {alpha})'
        }
        return color_map.get(severity.lower(), color_map['all'])

    @staticmethod
    def generate_gradient_colors(base_color, count):
        """그라데이션 색상 생성"""
        # 기본 구현 - 실제로는 더 복잡한 색상 계산 로직 필요
        return [base_color] * count
