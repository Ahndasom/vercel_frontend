from flask import Blueprint, jsonify, request
import requests
import os
# 이벤트 요약 패널 블루프린트
event_summary_bp = Blueprint('event_summary', __name__)
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')

@event_summary_bp.route('/proxy/events/summary')
def proxy_events_summary():
    """이벤트 요약 데이터 백엔드 API 프록시 (CORS 우회용)"""
    start_date = request.args.get('start')
    end_date = request.args.get('end')

    if not start_date or not end_date:
        return jsonify({"error": "start and end parameters required"}), 400

    try:
        # 실제 백엔드 호출
        backend_url = f"{BACKEND_URL}/api/v1/events/summary?start={start_date}&end={end_date}"
        response = requests.get(backend_url, timeout=10)

        if response.status_code == 200:
            data = response.json()
            print(f"[EVENT_SUMMARY] API 호출 성공: {data}")
            return jsonify(data)
        else:
            error_msg = f"Backend returned {response.status_code}"
            print(f"[EVENT_SUMMARY] API 오류: {error_msg}")
            return jsonify({"error": error_msg}), response.status_code

    except requests.RequestException as e:
        error_msg = f"Backend connection failed: {str(e)}"
        print(f"[EVENT_SUMMARY] 연결 오류: {error_msg}")
        return jsonify({"error": error_msg}), 500


class EventSummaryComponent:
    """이벤트 요약 카드 컴포넌트 클래스"""

    @staticmethod
    def format_summary_data(raw_data):
        """백엔드 응답 데이터를 프론트엔드 형식으로 변환"""
        if not raw_data or 'counts' not in raw_data:
            return {
                'total': 0,
                'critical': 0,
                'warn': 0,
                'info': 0,
                'range': {
                    'start': 'N/A',
                    'end': 'N/A'
                }
            }

        counts = raw_data['counts']
        return {
            'total': counts.get('total', 0),
            'critical': counts.get('critical', 0),
            'warn': counts.get('warn', 0),
            'info': counts.get('info', 0),
            'range': raw_data.get('range', {'start': 'N/A', 'end': 'N/A'})
        }

    @staticmethod
    def validate_date_range(start_date, end_date):
        """날짜 범위 유효성 검사"""
        if not start_date or not end_date:
            return False, "시작일과 종료일이 필요합니다"

        from datetime import datetime
        try:
            start = datetime.strptime(start_date, '%Y-%m-%d')
            end = datetime.strptime(end_date, '%Y-%m-%d')

            if start > end:
                return False, "시작일이 종료일보다 늦을 수 없습니다"

            return True, "유효한 날짜 범위입니다"

        except ValueError:
            return False, "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)"


# 추가적인 유틸리티 함수들
def get_severity_stats(data, severity_filter='all'):
    """특정 중요도에 따른 통계 추출"""
    if not data or 'counts' not in data:
        return {'total': 0, 'critical': 0, 'warn': 0, 'info': 0}

    counts = data['counts']

    if severity_filter == 'all':
        return counts
    elif severity_filter == 'critical':
        return {'total': counts.get('critical', 0), 'critical': counts.get('critical', 0), 'warn': 0, 'info': 0}
    elif severity_filter == 'warn':
        return {'total': counts.get('warn', 0), 'critical': 0, 'warn': counts.get('warn', 0), 'info': 0}
    elif severity_filter == 'info':
        return {'total': counts.get('info', 0), 'critical': 0, 'warn': 0, 'info': counts.get('info', 0)}
    else:
        return counts


def calculate_event_trend(current_data, previous_data):
    """이벤트 증감률 계산"""
    if not previous_data or not current_data:
        return {'trend': 0, 'percentage': 0}

    current_total = current_data.get('total', 0)
    previous_total = previous_data.get('total', 0)

    if previous_total == 0:
        return {'trend': current_total, 'percentage': 100 if current_total > 0 else 0}

    trend = current_total - previous_total
    percentage = (trend / previous_total) * 100

    return {'trend': trend, 'percentage': round(percentage, 2)}