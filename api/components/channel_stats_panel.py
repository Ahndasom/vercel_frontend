from flask import Blueprint, jsonify, request
import requests
import os

# 채널 통계 패널 블루프린트
channel_stats_bp = Blueprint('channel_stats', __name__)
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')

@channel_stats_bp.route('/proxy/channels')
def proxy_channels_summary():
    """전체 채널 요약 통계 백엔드 API 프록시 (CORS 우회용)"""
    start_date = request.args.get('start')
    end_date = request.args.get('end')
    severity = request.args.get('severity', 'all')

    if not start_date or not end_date:
        return jsonify({"error": "start and end parameters required"}), 400

    try:
        # 실제 백엔드 호출
        backend_url = f"{BACKEND_URL}/api/v1/channels?start={start_date}&end={end_date}&severity={severity}"
        response = requests.get(backend_url, timeout=10)

        if response.status_code == 200:
            data = response.json()
            print(f"[CHANNEL_STATS] API 호출 성공: {data}")
            return jsonify(data)
        else:
            error_msg = f"Backend returned {response.status_code}"
            print(f"[CHANNEL_STATS] API 오류: {error_msg}")
            return jsonify({"error": error_msg}), response.status_code

    except requests.RequestException as e:
        error_msg = f"Backend connection failed: {str(e)}"
        print(f"[CHANNEL_STATS] 연결 오류: {error_msg}")
        return jsonify({"error": error_msg}), 500


class ChannelStatsComponent:
    """채널 통계 컴포넌트 클래스"""

    @staticmethod
    def format_channel_grid_data(raw_data):
        """채널 그리드 표시용 데이터 포맷"""
        if not raw_data or 'items' not in raw_data:
            return []

        channels = raw_data['items']
        formatted_channels = []

        for channel in channels:
            formatted_channels.append({
                'channel_id': channel.get('channel_id'),
                'name': channel.get('name', f"CH{channel.get('channel_id', '00').zfill(2)}"),
                'total_events': channel.get('count', 0),
                'status': channel.get('status', 'OFF').upper(),
                'by_type': channel.get('by_type', []),
                'location_name': channel.get('location_name', '정보 없음')
            })

        # 채널 번호순으로 정렬
        return sorted(formatted_channels, key=lambda x: int(x['channel_id']) if x['channel_id'] else 0)

    @staticmethod
    def get_channel_status_summary(channels_data):
        """채널 상태 요약 통계"""
        if not channels_data:
            return {'total': 0, 'online': 0, 'offline': 0, 'online_rate': 0}

        total = len(channels_data)
        online = sum(1 for ch in channels_data if ch.get('status', '').upper() == 'ON')
        offline = total - online
        online_rate = round((online / total * 100), 1) if total > 0 else 0

        return {
            'total': total,
            'online': online,
            'offline': offline,
            'online_rate': online_rate
        }

    @staticmethod
    def get_top_active_channels(channels_data, limit=5):
        """가장 활성화된 채널들 (이벤트 수 기준)"""
        if not channels_data:
            return []

        sorted_channels = sorted(channels_data,
                                 key=lambda x: x.get('total_events', 0),
                                 reverse=True)

        return sorted_channels[:limit]

    @staticmethod
    def calculate_channel_event_distribution(channels_data):
        """채널별 이벤트 분포 통계"""
        if not channels_data:
            return {'total_events': 0, 'avg_per_channel': 0, 'max_events': 0, 'min_events': 0}

        event_counts = [ch.get('total_events', 0) for ch in channels_data]

        total_events = sum(event_counts)
        avg_per_channel = round(total_events / len(channels_data), 2) if channels_data else 0
        max_events = max(event_counts) if event_counts else 0
        min_events = min(event_counts) if event_counts else 0

        return {
            'total_events': total_events,
            'avg_per_channel': avg_per_channel,
            'max_events': max_events,
            'min_events': min_events
        }

    @staticmethod
    def filter_channels_by_status(channels_data, status_filter='all'):
        """상태별 채널 필터링"""
        if not channels_data or status_filter.lower() == 'all':
            return channels_data

        return [ch for ch in channels_data
                if ch.get('status', '').upper() == status_filter.upper()]

    @staticmethod
    def get_channel_tooltip_data(channel):
        """채널 툴팁용 데이터 생성"""
        tooltip_data = {
            'title': channel.get('name', f"CH{channel.get('channel_id', '00').zfill(2)}"),
            'total_events': channel.get('total_events', 0),
            'status': channel.get('status', 'OFF'),
            'details': []
        }

        # 이벤트 타입별 상세 정보
        if channel.get('by_type'):
            for event_type in channel['by_type']:
                tooltip_data['details'].append({
                    'label': event_type.get('label', 'Unknown'),
                    'count': event_type.get('count', 0)
                })

        return tooltip_data


# 채널 상태 관련 유틸리티
class ChannelStatusUtils:
    """채널 상태 관련 유틸리티"""

    STATUS_COLORS = {
        'ON': {'bg': '#28a745', 'text': 'white'},
        'OFF': {'bg': '#dc3545', 'text': 'white'},
        'MAINTENANCE': {'bg': '#ffc107', 'text': 'black'},
        'ERROR': {'bg': '#6c757d', 'text': 'white'}
    }

    @staticmethod
    def get_status_color(status):
        """상태별 색상 반환"""
        return ChannelStatusUtils.STATUS_COLORS.get(
            status.upper(),
            ChannelStatusUtils.STATUS_COLORS['OFF']
        )

    @staticmethod
    def get_status_icon(status):
        """상태별 아이콘 반환"""
        icon_map = {
            'ON': '🟢',
            'OFF': '🔴',
            'MAINTENANCE': '🟡',
            'ERROR': '⚫'
        }
        return icon_map.get(status.upper(), '❓')

    @staticmethod
    def validate_channel_id(channel_id):
        """채널 ID 유효성 검사"""
        try:
            if channel_id == 'all':
                return True, "전체 채널"

            ch_int = int(channel_id)
            if 1 <= ch_int <= 999:  # 채널 번호 범위 가정
                return True, f"채널 {ch_int}"
            else:
                return False, "채널 번호는 1-999 범위여야 합니다"

        except (ValueError, TypeError):
            return False, "유효하지 않은 채널 ID입니다"


# 채널 검색 및 필터링
class ChannelFilterUtils:
    """채널 검색 및 필터링 유틸리티"""

    @staticmethod
    def search_channels(channels_data, search_term):
        """채널 검색"""
        if not channels_data or not search_term:
            return channels_data

        search_term = search_term.lower()
        filtered_channels = []

        for channel in channels_data:
            # 채널 ID, 이름, 위치 정보에서 검색
            if (search_term in str(channel.get('channel_id', '')).lower() or
                    search_term in channel.get('name', '').lower() or
                    search_term in channel.get('location_name', '').lower()):
                filtered_channels.append(channel)

        return filtered_channels

    @staticmethod
    def filter_by_event_count(channels_data, min_events=0, max_events=None):
        """이벤트 수 범위로 채널 필터링"""
        if not channels_data:
            return []

        filtered = []
        for channel in channels_data:
            event_count = channel.get('total_events', 0)

            if event_count >= min_events:
                if max_events is None or event_count <= max_events:
                    filtered.append(channel)

        return filtered